import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedServer } from '../apps/server/server.js';
import { assignmentDetails } from '../apps/server/canvas.js';
import { publicAddress } from '../apps/server/network.js';
import { onePagePdf } from './helpers/pdf.js';
import { crc32, deflateRawSync } from 'node:zlib';

function wordDocument(text) {
  const name = Buffer.from('word/document.xml');
  const xml = Buffer.from(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  );
  const data = deflateRawSync(xml),
    header = Buffer.alloc(30),
    directory = Buffer.alloc(46),
    end = Buffer.alloc(22);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(crc32(xml), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(xml.length, 22);
  header.writeUInt16LE(name.length, 26);
  directory.writeUInt32LE(0x02014b50);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(8, 10);
  directory.writeUInt32LE(crc32(xml), 16);
  directory.writeUInt32LE(data.length, 20);
  directory.writeUInt32LE(xml.length, 24);
  directory.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length + name.length, 12);
  end.writeUInt32LE(header.length + name.length + data.length, 16);
  return Buffer.concat([header, name, data, directory, name, end]);
}

test('hosted document workers extract PDF, Office and notebook text without executing cells', async (t) => {
  const app = await fixture(t),
    alice = await app.login('formats@example.com');
  const pdf = await app.documents.import(
    alice.user.id,
    'lecture.pdf',
    Buffer.from(onePagePdf('Course PDF text'))
  );
  assert.equal(pdf.kind, 'pdf');
  assert.match((await app.documents.index(alice.user.id, pdf)).pages[0].text, /Course PDF text/);
  const office = await app.documents.import(
    alice.user.id,
    'lecture.docx',
    wordDocument('Eigenvectors and geometry')
  );
  assert.match(
    (await app.documents.index(alice.user.id, office)).pages[0].text,
    /Eigenvectors and geometry/
  );
  const notebook = await app.documents.import(
    alice.user.id,
    'lab.ipynb',
    Buffer.from(
      JSON.stringify({
        cells: [
          {
            cell_type: 'code',
            source: ['raise Exception("Do not execute")'],
            outputs: [{ text: ['Saved result 42'] }],
          },
        ],
      })
    )
  );
  assert.match(
    (await app.documents.index(alice.user.id, notebook)).pages[0].text,
    /Do not execute[\s\S]*Saved result 42/
  );
});

test('hidden assignments persist per account without altering submission status or other course IDs', async (t) => {
  const app = await fixture(t),
    alice = await app.login('hide@example.com'),
    bob = await app.login('other@example.com');
  await app.request('/api/action', {
    ...alice,
    data: { action: 'create', name: 'Private assignments' },
  });
  const account = app.workspaces.account(alice.user.id),
    course = account.library.courses[0];
  course.canvasMaterials = [
    {
      id: 'assignments:1',
      kind: 'assignments',
      title: 'Exercise',
      assignment: { status: 'submitted', submissionTypes: ['online_upload'] },
    },
  ];
  const action = {
    action: 'assignmentVisibility',
    courseID: course.id,
    id: 'assignments:1',
    enabled: true,
  };
  assert.equal((await app.request('/api/action', { ...bob, data: action })).status, 404);
  assert.equal((await app.request('/api/action', { ...alice, data: action })).status, 200);
  const saved = app.store.account(alice.user.id).library.courses[0];
  assert.deepEqual(saved.hiddenAssignmentIDs, ['assignments:1']);
  assert.equal(saved.canvasMaterials[0].assignment.status, 'submitted');
  await app.request('/api/action', { ...alice, data: { ...action, enabled: false } });
  assert.deepEqual(app.store.account(alice.user.id).library.courses[0].hiddenAssignmentIDs, []);
});

test('each hosted user indexes Canvas privately and opens the assignment PDF on demand', async (t) => {
  const calls = [];
  const remoteRequest = async (address, options) => {
    const url = new URL(address),
      token = options.headers?.Authorization;
    calls.push({ path: url.pathname, token });
    if (url.hostname === 'files.example') {
      assert.equal(token, undefined, 'Canvas credentials must not reach the file host');
      return { status: 200, headers: {}, data: Buffer.from(onePagePdf('Assignment PDF body')) };
    }
    const identity = token === 'Bearer alice-canvas-token' ? 'Alice' : 'Bob';
    const assignment = {
      id: 1,
      name: `${identity} exercise`,
      due_at: '2026-10-02T18:00:00Z',
      submission_types: ['online_upload'],
      submission: { workflow_state: identity === 'Alice' ? 'submitted' : 'unsubmitted' },
      description: '<p>Show your work.</p><a href="/courses/1/files/2/download">PDF</a>',
    };
    const file = {
      id: 2,
      display_name: 'Exercises',
      filename: 'Exercises.pdf',
      size: 1000,
      url: 'https://files.example/exercise.pdf',
      updated_at: '2026-09-01T00:00:00Z',
    };
    const bodies = {
      '/api/v1/users/self/profile': { id: identity === 'Alice' ? 1 : 2, name: identity },
      '/api/v1/courses': [
        {
          id: 1,
          name: `${identity} private course`,
          course_code: 'MATH',
          term: { name: 'Autumn 2026' },
        },
      ],
      '/api/v1/courses/1/files': [file],
      '/api/v1/courses/1/assignments': [assignment],
      '/api/v1/courses/1/pages': [],
      '/api/v1/courses/1/modules': [],
      '/api/v1/courses/1/assignments/1': assignment,
      '/api/v1/courses/1/files/2': file,
    };
    assert.ok(Object.hasOwn(bodies, url.pathname), url.pathname);
    return { status: 200, headers: {}, data: Buffer.from(JSON.stringify(bodies[url.pathname])) };
  };
  const app = await fixture(t, { canvasHosts: ['canvas.example'], remoteRequest });
  const alice = await app.login('canvas-alice@example.com'),
    bob = await app.login('canvas-bob@example.com');
  for (const [user, token] of [
    [alice, 'alice-canvas-token'],
    [bob, 'bob-canvas-token'],
  ]) {
    assert.equal(
      (
        await app.request('/api/action', {
          ...user,
          data: { action: 'connect', origin: 'https://canvas.example', token },
        })
      ).status,
      200
    );
    await app.workspaces.account(user.user.id).job;
  }
  assert.equal(
    calls.some((c) => c.path.endsWith('.pdf')),
    false,
    'Indexing fetches metadata only'
  );
  const state = (await app.request('/api/state', alice)).body,
    course = state.library.courses[0];
  assert.equal(course.name, 'Alice private course');
  const opened = await app.request('/api/action', {
    ...alice,
    data: { action: 'assignment', courseID: course.id, id: 'assignments:1' },
  });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.assignmentNotice, null);
  const doc = opened.body.library.courses[0].documents.find(
    (d) => d.id === opened.body.library.selectedDocumentID
  );
  assert.equal(doc.kind, 'pdf');
  assert.match(opened.body.assignmentText, /Show your work/);
  assert.match(opened.body.pageText, /Assignment PDF body/);
  assert.equal((await app.request(`/api/document/${doc.id}`, bob)).status, 404);
  assert.doesNotMatch(
    JSON.stringify((await app.request('/api/state', bob)).body),
    /Alice|Assignment PDF body/
  );
  assert.doesNotMatch(JSON.stringify(opened.body), /alice-canvas-token|bob-canvas-token/);
});

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'scholia-hosted-test-'));
  const reserve = createServer();
  await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const app = createHostedServer({ root, origin: `http://127.0.0.1:${port}`, ...options });
  await new Promise((resolve) => app.server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const request = async (path, { cookie, csrf, data, method, ...rest } = {}) => {
    const response = await fetch(url + path, {
      method: method || (data ? 'POST' : 'GET'),
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { 'X-Scholia-Token': csrf } : {}),
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...rest.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
      redirect: 'manual',
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: response.status, body, headers: response.headers };
  };
  const login = async (email) => {
    const user = await app.store.createUser(email, 'correct horse battery staple');
    const result = await request('/auth/login', {
      data: { email, password: 'correct horse battery staple' },
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const cookie = result.headers.get('set-cookie').split(';')[0];
    const session = app.store.session(cookie.split('=')[1]);
    return { user, cookie, csrf: session.csrf, session };
  };
  return { ...app, root, request, login };
}

test('hosted accounts isolate workspaces, documents, conversations, credentials and sessions over HTTP', async (t) => {
  const app = await fixture(t, {
    complete: async (payload, _settings, onToken) => {
      const text = `Private reply: ${payload.messages.at(-1).content}`;
      onToken(text);
      return { text };
    },
  });
  const alice = await app.login('alice@example.com'),
    bob = await app.login('bob@example.com');
  const call = (user, action) => app.request('/api/action', { ...user, data: action });
  const a = await call(alice, { action: 'create', name: 'Alice private course', code: 'ALICE' });
  const aid = a.body.library.selectedCourseID;
  assert.ok(aid);
  assert.equal((await call(bob, { action: 'course', id: aid })).status, 404);
  await call(bob, { action: 'create', name: 'Bob private course', code: 'BOB' });
  assert.doesNotMatch(JSON.stringify((await app.request('/api/state', bob)).body), /Alice/);
  await call(alice, {
    action: 'import',
    name: 'secret.txt',
    data: Buffer.from('Alice private file content').toString('base64'),
  });
  await app.workspaces.account(alice.user.id).job;
  let state = (await app.request('/api/state', alice)).body;
  const doc = state.library.courses[0].documents[0];
  assert.ok(doc);
  assert.equal((await app.request(`/api/document/${doc.id}`, bob)).status, 404);
  assert.equal((await app.request(`/api/index/${doc.id}`, bob)).status, 404);
  assert.equal((await app.request(`/api/edit/${doc.id}`, bob)).status, 404);
  assert.equal((await call(bob, { action: 'resume', id: doc.id })).status, 404);
  assert.equal(
    (await app.request(`/api/document/${doc.id}`, alice)).body,
    'Alice private file content'
  );
  state = (await call(alice, { action: 'document', id: doc.id })).body;
  state = (await call(alice, { action: 'draft', text: 'Alice question', owner: state.draftOwner }))
    .body;
  const stale = state.draftOwner;
  state = (
    await call(alice, { action: 'draft', text: 'Alice newer question', owner: state.draftOwner })
  ).body;
  assert.equal((await call(alice, { action: 'send', text: 'stale', owner: stale })).status, 409);
  state = (
    await call(alice, { action: 'send', text: 'Alice newer question', owner: state.draftOwner })
  ).body;
  await app.workspaces.account(alice.user.id).job;
  state = (await app.request('/api/state', alice)).body;
  assert.match(state.messages.at(-1).content, /Alice newer question/);
  assert.doesNotMatch(
    JSON.stringify((await app.request('/api/state', bob)).body),
    /Alice|secret.txt/
  );
  await call(alice, {
    action: 'credentials',
    providerID: 'openai',
    key: 'private-alice-provider-key',
  });
  assert.equal(
    app.store.credential(alice.user.id, 'provider:openai'),
    'private-alice-provider-key'
  );
  assert.equal(app.store.credential(bob.user.id, 'provider:openai'), '');
  assert.doesNotMatch(
    JSON.stringify((await app.request('/api/state', alice)).body),
    /private-alice-provider-key/
  );
  const encrypted = app.store.db
    .prepare('SELECT value FROM credentials WHERE user_id=?')
    .get(alice.user.id).value;
  assert.doesNotMatch(encrypted, /private-alice-provider-key/);
  const saved = app.store.account(alice.user.id);
  assert.equal(saved.library.courses[0].documents[0].id, doc.id);
  assert.equal((await app.request('/auth/logout', { ...alice, data: {} })).status, 200);
  assert.equal((await app.request('/api/state', alice)).status, 401);
  assert.equal((await app.request('/api/state', bob)).status, 200);
});

test('hosted service rejects anonymous, cross-site, wrong-host and missing-CSRF requests', async (t) => {
  const app = await fixture(t),
    user = await app.login('private@example.com');
  assert.equal((await app.request('/api/state')).status, 401);
  assert.equal((await app.request('/api/state', { cookie: user.cookie })).status, 403);
  assert.equal(
    (await app.request('/api/state', { ...user, headers: { Origin: 'https://evil.example' } }))
      .status,
    403
  );
  const rejectedHost = await new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: app.server.address().port,
        path: '/api/state',
        headers: { Host: 'evil.example', Cookie: user.cookie, 'X-Scholia-Token': user.csrf },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      }
    );
    request.on('error', reject);
    request.end();
  });
  assert.equal(rejectedHost, 403);
  assert.equal(
    (await app.request('/api/action', { ...user, data: { action: 'native' } })).status,
    400
  );
  const wrong = await app.request('/auth/login', {
    data: { email: 'private@example.com', password: 'wrong' },
  });
  assert.equal(wrong.status, 401);
  const row = app.store.db.prepare('SELECT password FROM users WHERE id=?').get(user.user.id);
  assert.notEqual(row.password, 'correct horse battery staple');
  assert.match(user.cookie, /scholia_session=/);
});

test('two logins for one account keep navigation separate and validate edits by revision', async (t) => {
  const app = await fixture(t),
    user = await app.login('reader@example.com');
  const call = (client, data) => app.request('/api/action', { ...client, data });
  const first = (await call(user, { action: 'create', name: 'Course A' })).body.library
    .selectedCourseID;
  const second = (await call(user, { action: 'create', name: 'Course B' })).body.library
    .selectedCourseID;
  const auth = await app.request('/auth/login', {
    data: { email: 'reader@example.com', password: 'correct horse battery staple' },
  });
  const cookie = auth.headers.get('set-cookie').split(';')[0],
    session = app.store.session(cookie.split('=')[1]),
    other = { cookie, csrf: session.csrf };
  await call(other, { action: 'course', id: first });
  assert.equal((await app.request('/api/state', user)).body.library.selectedCourseID, second);
  await call(user, {
    action: 'import',
    name: 'edit.txt',
    data: Buffer.from('Original text').toString('base64'),
  });
  await app.workspaces.account(user.user.id).job;
  const doc = (await app.request('/api/state', user)).body.library.courses.find(
    (c) => c.id === second
  ).documents[0];
  await call(user, { action: 'document', id: doc.id });
  const edit = (await app.request(`/api/edit/${doc.id}`, user)).body;
  const saved = await call(user, {
    action: 'saveDocument',
    edit: { ...edit, source: 'Changed text' },
  });
  assert.equal(saved.status, 200);
  const current = saved.body.library.selectedDocumentID;
  assert.equal((await app.request(`/api/document/${current}`, user)).body, 'Changed text');
  assert.equal((await call(user, { action: 'saveDocument', edit })).status, 409);
  const fresh = (await app.request(`/api/edit/${current}`, user)).body;
  assert.equal(
    (await call(user, { action: 'saveDocument', edit: { ...fresh, source: '' } })).status,
    200
  );
  assert.equal((await app.request(`/api/document/${current}`, user)).body, '');
  assert.equal((await app.request('/api/state', other)).body.library.selectedCourseID, first);
});

test('Canvas submission mapping and outbound addresses preserve status and credential boundaries', () => {
  const origin = 'https://canvas.example';
  assert.equal(
    assignmentDetails({ submission: { workflow_state: 'graded', missing: true } }, origin, 1)
      .status,
    'notSubmitted'
  );
  assert.equal(
    assignmentDetails({ submission: { workflow_state: 'pending_review' } }, origin, 1).status,
    'submitted'
  );
  assert.equal(assignmentDetails({}, origin, 1).status, 'unknown');
  assert.deepEqual(
    assignmentDetails(
      {
        description:
          '<a href="/courses/1/files/2/download">PDF</a><a href="https://evil.example/files/3">other</a><a href="/courses/4/files/5">wrong course</a>',
      },
      origin,
      1
    ).linkedFileIDs,
    ['2']
  );
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    '192.168.0.1',
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('1.1.1.1'), true);
});
