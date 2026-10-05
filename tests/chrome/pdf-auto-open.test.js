import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['apps/chrome/src/service-worker.js'],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser'
});

function event() {
  const listeners = [];
  return { addListener: (listener) => listeners.push(listener), emit: (...args) => listeners.forEach((fn) => fn(...args)) };
}

function storage() {
  const values = {};
  return {
    async get(key) { return key ? { [key]: values[key] } : { ...values }; },
    async set(items) { Object.assign(values, items); },
    async remove(key) { delete values[key]; }
  };
}

function workerHarness({ brave, url, mimeFrame = false }) {
  let tab = { id: 1, windowId: 1, url, status: 'complete' };
  const updates = [];
  const timers = new Map();
  const chrome = {
    runtime: {
      onInstalled: event(), onStartup: event(), onMessage: event(), onConnect: event(),
      getURL: (path) => `chrome-extension://scholia/${path}`,
      async getContexts() {
        return mimeFrame ? [{ documentUrl: 'chrome-extension://scholia/pdf-viewer.html', frameId: 5 }] : [];
      }
    },
    alarms: { onAlarm: event() },
    commands: { onCommand: event() },
    contextMenus: { onClicked: event() },
    storage: { local: storage(), session: storage() },
    tabs: {
      onCreated: event(), onUpdated: event(), onRemoved: event(),
      async query() { return [tab]; },
      async get() { return tab; },
      async update(id, options) { updates.push({ id, ...options }); return { ...tab, ...options }; }
    }
  };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    chrome, navigator: brave ? { brave: { isBrave: async () => true } } : {},
    URL, console, crypto: { randomUUID },
    setTimeout(fn) { const id = randomUUID(); timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  return {
    updates,
    navigate(changeInfo) { chrome.tabs.onUpdated.emit(1, changeInfo, tab); },
    restore() {
      chrome.tabs.onCreated.emit({ id: tab.id });
      chrome.tabs.onUpdated.emit(tab.id, { status: 'complete' }, tab);
    },
    changeUrl(next) { tab = { ...tab, url: next }; },
    async flush() {
      for (const [id, fn] of timers) { timers.delete(id); fn(); }
      await new Promise(setImmediate);
    }
  };
}

for (const brave of [false, true]) {
  for (const url of ['file:///Users/reader/Lecture%20notes.PDF#page=2', 'https://example.test/notes.pdf']) {
    test(`${brave ? 'Brave' : 'Chromium'} automatically opens ${new URL(url).protocol} PDFs without the MIME API`, async () => {
      const worker = workerHarness({ brave, url });
      worker.navigate({ status: 'loading' });
      await worker.flush();
      assert.equal(worker.updates.length, 0);
      worker.navigate({ status: 'complete' });
      await worker.flush();
      assert.equal(worker.updates.length, 1);
      assert.match(worker.updates[0].url, /^chrome-extension:\/\/scholia\/pdf-viewer.html\?source=/);
    });
  }
}

test('automatic fallback leaves an active MIME reader in place', async () => {
  const worker = workerHarness({ brave: true, url: 'file:///Users/reader/notes.pdf', mimeFrame: true });
  worker.navigate({ status: 'complete' });
  await worker.flush();
  assert.equal(worker.updates.length, 0);
});

test('a delayed PDF handoff cannot replace a tab that has navigated away', async () => {
  const worker = workerHarness({ brave: true, url: 'file:///Users/reader/notes.pdf' });
  worker.navigate({ status: 'complete' });
  worker.changeUrl('https://example.test/');
  await worker.flush();
  assert.equal(worker.updates.length, 0);
});

test('restoring a standalone reader does not send it back into native PDF navigation', async () => {
  const worker = workerHarness({
    brave: true,
    url: 'chrome-extension://scholia/pdf-viewer.html?source=restore-pdf-12345'
  });
  worker.restore();
  await worker.flush();
  assert.deepEqual(worker.updates, []);
});
