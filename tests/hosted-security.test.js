import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../apps/server/store.js';
import { Workspaces } from '../apps/server/workspaces.js';
import { Canvas } from '../apps/server/canvas.js';

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'scholia-security-'));
  const store = new AccountStore(root);
  const documents = {
    index: async () => ({ pages: [{ number: 1, text: 'Private document' }] }),
    import: async (_user, fileName) => ({
      id: randomUUID(),
      fileName,
      title: fileName,
      kind: 'text',
      pageCount: 1,
    }),
    ...options.documents,
  };
  const workspaces = new Workspaces(store, documents, options);
  t.after(async () => {
    await workspaces.stop();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const user = await store.createUser('owner@example.com', 'a sufficiently long password');
  const login = await store.login(user.email, 'a sufficiently long password');
  return { store, documents, workspaces, user, login, session: () => store.session(login.value) };
}

test('queued actions refresh same-session navigation before validating draft ownership', async (t) => {
  const app = await fixture(t);
  const first = await app.workspaces.action(app.session(), {
    action: 'create',
    name: 'First course',
  });
  const staleSession = app.session();
  const second = await app.workspaces.action(app.session(), {
    action: 'create',
    name: 'Second course',
  });
  await assert.rejects(
    app.workspaces.action(staleSession, {
      action: 'draft',
      text: 'A stale first-course draft',
      owner: first.draftOwner,
    }),
    { status: 409 }
  );
  assert.equal(app.session().navigation.selectedCourseID, second.library.selectedCourseID);
  assert.equal(app.store.account(app.user.id).library.courses[0].threads.length, 0);
});

test('background imports exclude conflicting writes but permit navigation', async (t) => {
  let finishImport;
  const app = await fixture(t, {
    documents: {
      import: () =>
        new Promise((resolve) => {
          finishImport = resolve;
        }),
    },
  });
  await app.workspaces.action(app.session(), { action: 'create', name: 'Import destination' });
  const account = app.workspaces.account(app.user.id),
    course = account.library.courses[0];
  course.canvasMaterials.push({ id: 'files:1', kind: 'files', title: 'Uncached file' });
  await app.workspaces.action(app.session(), {
    action: 'import',
    name: 'notes.txt',
    data: Buffer.from('notes').toString('base64'),
  });
  try {
    for (const action of [
      { action: 'material', id: 'files:1' },
      { action: 'saveDocument', edit: {} },
      { action: 'connect', origin: 'https://canvas.ntnu.no', token: 'replacement' },
      { action: 'import', name: 'other.txt', data: 'YWJj' },
    ])
      await assert.rejects(app.workspaces.action(app.session(), action), { status: 409 });
    await app.workspaces.action(app.session(), { action: 'create', name: 'Another destination' });
    assert.equal(account.library.courses.length, 2);
  } finally {
    finishImport({
      id: randomUUID(),
      fileName: 'notes.txt',
      title: 'notes',
      kind: 'text',
      pageCount: 1,
    });
    await account.job;
  }
  assert.equal(account.settings.storageBytes, 5);
  assert.equal(course.documents.length, 1);
  assert.equal(account.library.courses[1].documents.length, 0);
});

test('failed Canvas replacement preserves the link to locally edited material', async (t) => {
  const app = await fixture(t, {
    documents: {
      import: async () => {
        throw new Error('Cannot index this file.');
      },
    },
  });
  await app.workspaces.action(app.session(), { action: 'create', name: 'Course' });
  const account = app.workspaces.account(app.user.id),
    course = account.library.courses[0];
  Object.assign(course, { canvasOrigin: 'https://canvas.ntnu.no', canvasUserID: 4 });
  account.library.canvasUserID = 4;
  const document = {
    id: randomUUID(),
    sourceKey: 'files:1',
    sourceVersion: 'old',
    title: 'My notes',
    locallyEditedAt: 1,
  };
  course.documents.push(document);
  const canvas = {
    origin: course.canvasOrigin,
    material: async () => ({
      reference: { version: 'new' },
      name: 'notes.txt',
      data: Buffer.from('updated'),
    }),
  };
  await assert.rejects(
    app.workspaces.fetchMaterial(account, course, { id: 'files:1', version: 'new' }, canvas),
    /Cannot index/
  );
  assert.equal(document.sourceKey, 'files:1');
  assert.equal(document.title, 'My notes');
});

test('account cache evicts only saved idle accounts and retains running jobs', async (t) => {
  const app = await fixture(t, { maxCachedAccounts: 1 });
  const second = await app.store.createUser('second@example.com', 'a sufficiently long password');
  const first = app.workspaces.account(app.user.id);
  first.settings.example = 'persisted';
  app.store.save(first);
  first.job = Promise.resolve();
  assert.throws(() => app.workspaces.account(second.id), { status: 503 });
  first.job = null;
  app.workspaces.account(second.id);
  assert.equal(app.workspaces.accounts.size, 1);
  assert.equal(app.workspaces.account(app.user.id).settings.example, 'persisted');
});

test('Canvas retries stop promptly when the user cancels', async () => {
  const controller = new AbortController();
  const canvas = new Canvas('https://canvas.ntnu.no', 'private-token', {
    signal: controller.signal,
    request: async () => ({ status: 429, headers: { 'retry-after': '60' } }),
  });
  const request = canvas.api('/api/v1/users/self/profile');
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});

test('Canvas downloads never attach the account token to an external file host', async () => {
  const requests = [];
  const canvas = new Canvas('https://canvas.ntnu.no', 'private-token', {
    request: async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? {
            status: 200,
            headers: {},
            data: JSON.stringify({
              id: 7,
              filename: 'reading.pdf',
              url: 'https://files.example.edu/reading.pdf',
            }),
          }
        : { status: 200, headers: {}, data: Buffer.from('file') };
    },
  });
  await canvas.material({ kind: 'files', remoteID: '7' }, { canvasID: 3 });
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-token');
  assert.deepEqual(requests[1].options.headers, {});
  assert.equal(requests[1].options.redirects, true);
});

test('encryption configuration rejects trailing non-hex text', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scholia-invalid-secret-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.throws(() => new AccountStore(root, { secret: 'ab'.repeat(32) + 'invalid' }), /64 hex/);
});

test('expired or revoked sessions cannot finish a queued mutation', async (t) => {
  const app = await fixture(t),
    session = app.session();
  app.store.logout(app.login.value);
  await assert.rejects(
    app.workspaces.action(session, { action: 'create', name: 'Revoked request' }),
    { status: 401 }
  );
  assert.equal(app.store.account(app.user.id).library.courses.length, 0);
});

test('successful logins retain at most twenty sessions per account', async (t) => {
  const app = await fixture(t);
  let latest;
  for (let i = 0; i < 20; i++)
    latest = await app.store.login(app.user.email, 'a sufficiently long password');
  assert.equal(app.store.session(app.login.value), null);
  assert.ok(app.store.session(latest.value));
  assert.equal(
    app.store.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=?').get(app.user.id)
      .count,
    20
  );
});
