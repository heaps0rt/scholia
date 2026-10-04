import test from 'node:test';
import assert from 'node:assert/strict';
import { Canvas } from '../apps/server/canvas.js';
import { CourseWebsites, courseWebsiteSeeds, parseCourseWebsite } from '../apps/server/course-websites.js';
import { courseLinkTarget } from '../packages/core/src/course-documents.js';
import { withinWebsite, courseWebsiteLink } from '../packages/core/src/course-websites.js';

const origin = 'https://canvas.ntnu.no', site = 'https://teaching.ntnu.no/tdt4120/2026h/';
const course = { code: 'TDT4120-26H', name: 'Algorithms', term: '2026 HØST', canvasOrigin: origin, canvasID: 1, canvasMaterials: [], documents: [] };
function fixture({ failedSite = false } = {}) {
  const requested = [];
  const client = new Canvas(origin, 'private-fixture', { request: async (url, options) => {
    requested.push(url.href);
    let body = [], headers = {}, status = 200;
    if (url.origin === origin) {
      assert.equal(options.headers.Authorization, 'Bearer private-fixture');
      if (url.pathname.endsWith('/discussion_topics')) {
        assert.equal(url.searchParams.get('only_announcements'), 'true');
        if (url.searchParams.has('page')) body = [{ message: `<p>We use this course website for all lecture notes: <a href='${site}'>here</a>.</p>`, html_url: origin + '/courses/1/discussion_topics/2' }];
        else { body = [{ message: 'Recent announcement with no site link' }]; headers.link = `<${origin}/api/v1/courses/1/discussion_topics?only_announcements=true&page=2>; rel="next"`; }
      }
      if (url.pathname.endsWith('/modules')) body = [{ id: 1, name: 'Links', items_count: 1, items: [{ type: 'ExternalUrl', title: 'Course homepage', external_url: site }] }];
      if (url.pathname === '/api/v1/courses/1') body = { syllabus_body: `<a href='${site}'>Course website</a>` };
      return { status, headers, data: Buffer.from(JSON.stringify(body)) };
    }
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    if (failedSite) return { status: 503, headers, data: Buffer.alloc(0) };
    if (options.method === 'HEAD') return { status, headers: { etag: 'file-v1', 'content-length': '30' }, data: Buffer.alloc(0) };
    if (url.href === site) body = `<html><head><title>Algorithms, Autumn 2026</title></head><body><main><h1>Algorithms, Autumn 2026</h1>
      <a href='weeks/one.html'>Week 1</a><a href='notes.pdf'>Lecture notes</a>
      <a href='../2025h/'>Wrong semester</a><a href='/tdt4120/2026h-other/'>Outside</a>
      <a href='?action=logout'>Log out</a><a href='javascript:alert(1)'>Script</a></main></body></html>`;
    else if (url.href === site + 'weeks/one.html') body = `<html><body><h1>Week one</h1><a href='../'>Back</a><a href='https://folk.ntnu.no/teacher/algorithms.ipynb'>Notebook</a></body></html>`;
    else if (url.pathname.endsWith('.pdf')) { body = '%PDF-1.4 notes'; headers['content-type'] = 'application/pdf'; }
    else if (url.pathname.endsWith('.ipynb')) body = '{"cells":[]}';
    else assert.fail(`Unexpected website request ${url.href}`);
    return { status, headers, data: Buffer.from(body) };
  } });
  return { client, requested };
}

test('older paginated announcements, syllabus and module URLs discover one bounded course website and its attachments', async () => {
  const { client, requested } = fixture();
  const catalog = await client.catalog(course);
  assert.deepEqual(catalog.warnings, []);
  assert.equal(catalog.items.length, 4);
  assert.equal(requested.filter(url => url === site).length, 1, 'same site in three sources is crawled once');
  assert.ok(requested.some(url => url.includes('only_announcements=true&page=2')));
  assert.ok(!requested.some(url => /2025h|2026h-other|logout/.test(url)));
  assert.ok(catalog.items.every(ref => ref.websiteRootURL === site));
  const pdf = catalog.items.find(ref => ref.fileName === 'notes.pdf');
  assert.equal((await client.material(pdf, course)).data.toString(), '%PDF-1.4 notes');
  assert.equal(courseLinkTarget(pdf.sourceURL, { ...course, canvasMaterials: catalog.items }).material.id, pdf.id);
  const next = fixture({ failedSite: true });
  const result = await next.client.catalog({ ...course, canvasMaterials: catalog.items });
  assert.equal(result.items.length, 4);
  assert.deepEqual(result.changes.removed, []);
  assert.match(result.warnings.join(), /503/);
});

test('announcement hints avoid unrelated references and institutional course descriptions', () => {
  const sources = [{ url: origin + '/courses/1/announcements', html: `<p>Our course website is <a href='https://algorithms.example.org/'>here</a>.</p>
    <p>Reference: <a href='https://random.example.org/'>external article</a></p>
    <p><a href='https://www.ntnu.no/studier/emner/TDT4120'>Official course description</a></p>
    <p><a href='https://youtube.com/tdt4120'>Recording</a></p>` }];
  assert.deepEqual(courseWebsiteSeeds(sources, course).map(seed => seed.url), ['https://algorithms.example.org/']);
  assert.equal(withinWebsite('https://teaching.ntnu.no/tdt4120/2026h-other/', site), false);
  assert.equal(withinWebsite('https://folk.ntnu.no/teacher/OTHER1000.html', 'https://folk.ntnu.no/teacher/TFY4345.html'), false);
  assert.equal(courseWebsiteLink('https://web.phys.ntnu.no/ovsys/admin/studentliste.php?course=TFY4115'), null);
  const file = courseWebsiteLink('https://www.ntnu.no/documents/10422/123/Exam.pdf/abcd-1234?t=123');
  assert.equal(file.kind, 'files');
  assert.equal(file.fileName, 'Exam.pdf');
  assert.equal(file.url, 'https://www.ntnu.no/documents/10422/123/Exam.pdf/abcd-1234');
  assert.equal(withinWebsite('https://teaching.ntnu.no/hub/login', 'https://teaching.ntnu.no/'), false);
  assert.equal(courseWebsiteLink('https://github.com/teacher/notes/edit/main/chapter.ipynb'), null);
  assert.equal(courseWebsiteLink('https://colab.research.google.com/github/teacher/notes/blob/main/chapter.ipynb').url,
    'https://raw.githubusercontent.com/teacher/notes/main/chapter.ipynb');
});

test('course entry redirects and NTNU short links resolve to teaching sites without importing login pages', async () => {
  const requested = [];
  const websites = new CourseWebsites({ request: async (url, options) => {
    requested.push(url.href);
    assert.deepEqual(options.headers, {});
    if (url.pathname === '/shortcourse') return { status: 200, headers: {}, data: Buffer.from(`<title>Shorty · Shorty</title><a class='action-button' href='${site}'>Yes, take me there!</a>`) };
    if (url.pathname === '/redirect') return { status: 302, headers: { location: site }, data: Buffer.alloc(0) };
    if (url.pathname === '/old') return { status: 302, headers: { location: site.replace('2026h', '2025h') }, data: Buffer.alloc(0) };
    if (url.pathname === '/private') return { status: 302, headers: { location: '/hub/login' }, data: Buffer.alloc(0) };
    assert.equal(url.href, site);
    return { status: 200, headers: {}, data: Buffer.from('<html><body><h1>Algorithms Autumn 2026</h1><p>Lecture notes</p></body></html>') };
  } });
  const result = await websites.catalog(course, ['https://s.ntnu.no/shortcourse', 'https://teaching.ntnu.no/redirect', 'https://teaching.ntnu.no/private', 'https://teaching.ntnu.no/old'].map(url => ({ url })));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].websiteRootURL, site);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.complete, false);
  assert.ok(!requested.some(url => /hub\/login|2025h/.test(url)));
  assert.throws(() => parseCourseWebsite('<html><head><title>JupyterHub</title></head><body>Sign in with Feide</body></html>'), /sign-in/);
  assert.throws(() => parseCourseWebsite('<html><head><title>Shorty · Shorty</title></head><body>Continue</body></html>'), /link-shortener/);
});
