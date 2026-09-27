import { Worker } from 'node:worker_threads';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash } from './store.js';
import { textIndexVersion } from './document-formats.js';
const mime = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ipynb: 'application/json',
};
export const documentMime = (doc) =>
  mime[extname(doc.fileName).slice(1).toLowerCase()] || 'application/octet-stream';
export class Documents {
  constructor(root) {
    this.root = root;
    this.active = 0;
    this.waiters = [];
  }
  directory(user, id) {
    if (![user, id].every((v) => /^[\da-f-]{36}$/i.test(v)))
      throw new Error('Invalid document identifier.');
    return join(this.root, 'files', user, id);
  }
  async import(
    user,
    name,
    data,
    { id = randomUUID(), allowEmpty = false, preserveOriginal = false } = {}
  ) {
    if ((!data.length && !allowEmpty) || data.length > 100_000_000)
      throw new Error('Choose a file between 1 byte and 100 MB.');
    name = basename(String(name).replaceAll('\\', '/')).slice(0, 240) || 'document.txt';
    if (this.waiters.length >= 12) throw new Error('The import queue is full. Try again shortly.');
    if (this.active >= 2) await new Promise((resolve) => this.waiters.push(resolve));
    this.active++;
    let result;
    try {
      result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./document-worker.js', import.meta.url), {
          workerData: { name, data },
          resourceLimits: { maxOldGenerationSizeMb: 256 },
        });
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error('This document took too long to index.'));
        }, 90000);
        worker.once('message', (value) => {
          clearTimeout(timer);
          value.error ? reject(new Error(value.error)) : resolve(value);
          worker.terminate();
        });
        worker.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        worker.once('exit', (code) => {
          clearTimeout(timer);
          if (code !== 0) reject(new Error('The document indexer stopped.'));
        });
      });
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
    const path = this.directory(user, id);
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (!preserveOriginal) await writeFile(join(path, 'original'), data, { mode: 0o600 });
    const temporaryIndex = join(path, `index-${randomUUID()}.tmp`);
    await writeFile(temporaryIndex, JSON.stringify({ pages: result.pages }), { mode: 0o600 });
    await rename(temporaryIndex, join(path, 'index.json'));
    for (const [name, encoded] of Object.entries(result.images))
      await writeFile(join(path, name), Buffer.from(encoded, 'base64'), { mode: 0o600 });
    return {
      id,
      title: name.slice(0, name.length - extname(name).length) || name,
      fileName: name,
      originalFileName: name,
      kind: result.kind,
      pageCount: result.pages.length,
      unreadablePages: result.unreadablePages || 0,
      indexVersion: textIndexVersion,
      lastPage: 1,
      addedAt: Date.now() / 1000,
      contentHash: hash(data),
      contentNotice: result.notice || undefined,
    };
  }
  async reindex(user, doc) {
    return this.import(user, doc.fileName, await this.data(user, doc), {
      id: doc.storageID || doc.id,
      allowEmpty: true,
      preserveOriginal: true,
    });
  }
  async index(user, doc) {
    return JSON.parse(
      await readFile(join(this.directory(user, doc.storageID || doc.id), 'index.json'), 'utf8')
    );
  }
  async data(user, doc) {
    return readFile(join(this.directory(user, doc.storageID || doc.id), 'original'));
  }
  async image(user, doc, name) {
    const index = await this.index(user, doc);
    if (name !== basename(name) || !index.pages.some((page) => page.images?.includes(name)))
      throw new Error('Image not found.');
    return readFile(join(this.directory(user, doc.storageID || doc.id), name));
  }
}
