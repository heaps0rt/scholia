import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHostedServer } from '../../../apps/server/server.js';
import { chromiumSession } from './lib/chromium.mjs';

const root = await mkdtemp(join(tmpdir(), 'scholia-search-browser-'));
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const origin = `http://127.0.0.1:${port}`,
  app = createHostedServer({ root, origin });
const output = resolve('dist/verification');
let browser;
try {
  await mkdir(output, { recursive: true });
  const user = await app.store.createUser('search@example.com', 'correct horse battery staple');
  const a = {
    id: randomUUID(),
    name: 'Linear algebra',
    code: 'MATH',
    documents: [],
    threads: [],
    canvasMaterials: [],
  };
  const b = {
    id: randomUUID(),
    name: 'Machine learning',
    code: 'ML',
    documents: [],
    threads: [],
    canvasMaterials: [],
  };
  const notes = await app.documents.import(
    user.id,
    'lecture-notes.txt',
    Buffer.from('Opening page.')
  );
  notes.pageCount = 2;
  const payload =
    '<img src=x onerror=window.searchInjected=true> eigenvectors preserve direction. A change of basis changes coordinates.';
  await writeFile(
    join(app.documents.directory(user.id, notes.id), 'index.json'),
    JSON.stringify({
      pages: [
        { number: 1, text: 'Opening page.' },
        { number: 2, text: payload },
      ],
    })
  );
  a.documents.push(notes);
  b.documents.push(
    await app.documents.import(
      user.id,
      'eigenvectors-worksheet.txt',
      Buffer.from('Eigenvectors explain principal components.')
    )
  );
  app.workspaces.account(user.id).library.courses.push(a, b);
  await new Promise((resolve) => app.server.listen(port, '127.0.0.1', resolve));
  browser = await chromiumSession();
  const { evaluate, until, click, send } = browser;
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1460,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: origin });
  await until('document.querySelector("#sign-in") && document.readyState === "complete"');
  await evaluate(
    `document.querySelector('[name=email]').value='search@example.com'; document.querySelector('[name=password]').value='correct horse battery staple'; document.querySelector('#sign-in').requestSubmit()`
  );
  await until('document.querySelector(".study-dashboard")');
  await evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`
  );
  await until('document.querySelector("#workspace-search-dialog").open');
  assert.equal(await evaluate('document.activeElement.id'), 'workspace-search-query');
  const query = async (text) =>
    evaluate(
      `document.querySelector('#workspace-search-query').value=${JSON.stringify(text)}; document.querySelector('#workspace-search-query').dispatchEvent(new Event('input',{bubbles:true}))`
    );
  const select = async (id, value) =>
    evaluate(
      `document.querySelector(${JSON.stringify(id)}).value=${JSON.stringify(value)}; document.querySelector(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}))`
    );
  await query('eigenvectors');
  await until('document.querySelectorAll(".search-result").length === 2');
  assert.match(
    await evaluate('document.querySelector(".search-result-heading small").textContent'),
    /File name/
  );
  assert.equal(await evaluate('document.querySelectorAll(".search-result img").length'), 0);
  assert.equal(await evaluate('!!window.searchInjected'), false);
  assert.equal(
    await evaluate(
      '[...document.querySelectorAll(".search-result")].every(row => row.querySelector("mark"))'
    ),
    true
  );
  await browser.screenshot(join(output, 'needle-search-desktop.png'));
  await select('#workspace-search-scope', a.id);
  await until('document.querySelectorAll(".search-result").length === 1');
  assert.equal(
    await evaluate('document.querySelector(".search-result-heading small").textContent'),
    'Page 2'
  );
  await select('#workspace-search-mode', 'files');
  await until('document.querySelector(".search-status").textContent.startsWith("No matches")');
  await select('#workspace-search-mode', 'content');
  await query('"change of basis"');
  await until('document.querySelectorAll(".search-result").length === 1');
  await evaluate(
    `document.querySelector('#workspace-search-query').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}))`
  );
  assert.equal(await evaluate('document.activeElement.className'), 'search-result');
  await click('.search-result');
  await until(
    '!document.querySelector("#workspace-search-dialog").open && document.querySelector("#page-input")?.value === "2"'
  );
  assert.match(await evaluate('document.querySelector(".paper").textContent'), /change of basis/);
  await click('[data-action="search"]');
  assert.equal(await evaluate('document.querySelector("#workspace-search-scope").value'), a.id);
  await select('#workspace-search-scope', '');
  await query('eigenvectors');
  await until('document.querySelectorAll(".search-result").length === 2');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await browser.screenshot(join(output, 'needle-search-mobile.png'));
  assert.equal(
    await evaluate(
      'document.querySelector("#workspace-search-dialog").scrollWidth <= document.querySelector("#workspace-search-dialog").clientWidth + 1'
    ),
    true
  );
  await click('.search-close');
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector("[data-action=search]")).display !== "none"'
    ),
    true
  );
  assert.equal(
    await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
    true,
    'Search button fits mobile toolbar'
  );
  assert.equal(browser.errors.length, 0, JSON.stringify(browser.errors));
  console.log(
    'PASS: Chromium search shortcut, scopes, modes, phrases, page navigation, keyboard, escaped evidence and mobile layout.'
  );
} catch (error) {
  if (browser) {
    console.error(
      JSON.stringify({
        errors: browser.errors,
        body: await browser.evaluate('document.body.innerText'),
      })
    );
    await browser.screenshot(join(output, 'needle-search-failure.png'));
  }
  throw error;
} finally {
  await browser?.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
}
