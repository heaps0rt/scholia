import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHostedServer } from '../../../apps/server/server.js';
import { onePagePdf } from '../../../tests/helpers/pdf.js';
import { chromiumSession } from './lib/chromium.mjs';

const root = await mkdtemp(join(tmpdir(), 'scholia-pdf-download-'));
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const origin = `http://127.0.0.1:${port}`,
  app = createHostedServer({ root, origin });
let browser;
try {
  const user = await app.store.createUser('pdf@example.com', 'correct horse battery staple');
  const session = app.store.session(
    (await app.store.login('pdf@example.com', 'correct horse battery staple')).value
  );
  await app.workspaces.action(session, {
    action: 'create',
    name: 'Linear algebra',
    code: 'TMA4115',
  });
  const account = app.workspaces.account(user.id),
    course = account.library.courses[0];
  const bytes = Buffer.from(onePagePdf('Linear algebra: vectors and matrices.'));
  const doc = await app.documents.import(user.id, 'Lecture notes.pdf', bytes);
  course.documents.push(doc);
  app.store.save(account);
  await new Promise((resolve) => app.server.listen(port, '127.0.0.1', resolve));
  browser = await chromiumSession();
  const { send, evaluate, until, click } = browser;
  const downloads = join(root, 'downloads');
  await mkdir(downloads);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1460,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: origin });
  await until('document.readyState === "complete" && document.querySelector("#sign-in")');
  await evaluate(
    `document.querySelector('[name=email]').value='pdf@example.com'; document.querySelector('[name=password]').value='correct horse battery staple'; document.querySelector('#sign-in').requestSubmit()`
  );
  await until('document.querySelector(".study-dashboard")');
  await click(`[data-action=course][data-id="${course.id}"]`);
  await until(`document.querySelector('[data-action=document][data-id="${doc.id}"]')`);
  await click(`[data-action=document][data-id="${doc.id}"]`);
  await until(
    'document.querySelector(".pdfViewer .page canvas") && document.querySelectorAll(".textLayer span").length > 0'
  );
  assert.equal(
    await evaluate('document.querySelector("[data-pdf=download]").closest("details")'),
    null
  );
  assert.equal(
    await evaluate(
      'document.querySelector("[data-pdf=download]").getBoundingClientRect().width > 0'
    ),
    true
  );
  await mkdir(resolve('dist/verification'), { recursive: true });
  await browser.screenshot(resolve('dist/verification/pdf-download.png'));
  await click('[data-pdf=download]');
  let downloaded;
  for (let i = 0; i < 100; i++) {
    try {
      downloaded = await readFile(join(downloads, 'Lecture notes.pdf'));
      break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.deepEqual(
    downloaded,
    bytes,
    'Visible download button saves the original PDF with its filename'
  );
  assert.deepEqual(browser.errors, []);
  console.log(
    'PDF download Chromium smoke passed: visible toolbar button, original filename and exact bytes.'
  );
} catch (error) {
  if (browser) {
    console.error('PDF download smoke state:', await browser.evaluate('document.body.innerText'));
    console.error('Browser errors:', browser.errors);
  }
  throw error;
} finally {
  await browser?.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
}
