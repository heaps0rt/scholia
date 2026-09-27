import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Documents } from '../apps/server/documents.js';

test('unknown scientific text extensions are indexed without treating binaries as text', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scholia-worker-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const documents = new Documents(root),
    user = randomUUID();
  for (const name of ['in.nanowire', 'Ni.eam', 'parameters.dat', 'input']) {
    const text = Buffer.from('units metal\n# nickel potential\t58.6934\r\nÅngström\fend');
    const doc = await documents.import(user, name, text);
    assert.equal(doc.kind, 'code', name);
    assert.equal(doc.unreadablePages, 0);
    assert.deepEqual(await documents.data(user, doc), text);
    assert.match((await documents.index(user, doc)).pages[0].text, /nickel potential/);
  }
  for (const [name, data] of [
    ['archive.zip', Buffer.from('ASCII but known archive extension')],
    ['opaque.bin', Buffer.from('ASCII but known binary extension')],
    [
      'unknown.part',
      Buffer.concat([Buffer.from('Printable prefix '.repeat(1000)), Buffer.from([0])]),
    ],
    ['unknown.utf8', Buffer.from([0xc3, 0x28])],
    ['unknown.control', Buffer.from('Text with an escape\x1bcode')],
  ]) {
    const doc = await documents.import(user, name, data);
    assert.equal(doc.kind, 'preview', name);
    assert.equal(doc.unreadablePages, 1);
    assert.match(doc.contentNotice, /no readable text/);
    assert.equal((await documents.index(user, doc)).pages[0].text, '');
    assert.deepEqual(await documents.data(user, doc), data);
  }
  const image = await documents.import(user, 'diagram.png', Buffer.from('image fixture'));
  assert.equal(image.unreadablePages, 1);
});
