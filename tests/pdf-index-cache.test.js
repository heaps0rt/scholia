import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPdfIndexCacheRecord,
  MAX_CACHED_PDF_INDEX_CHARACTERS,
  normalizePdfIndexCacheRecord,
  pdfIndexCacheKey
} from '../apps/chrome/src/pdf-index-cache.js';

test('PDF index cache keys use the document fingerprint instead of its source URL', () => {
  const key = pdfIndexCacheKey({ numPages: 42, fingerprints: ['abc123', null] });
  assert.equal(key, 'v1:42:abc123');
  assert.equal(pdfIndexCacheKey({ numPages: 42, fingerprints: [] }), '');
});

test('PDF index cache records preserve complete searchable and context page data', () => {
  const record = createPdfIndexCacheRecord({
    key: 'v1:2:document',
    pageCount: 2,
    indexedPageCount: 2,
    searchTexts: ['Page one', 'Page two'],
    contextPages: ['Page one', 'Page two'],
    title: 'Lecture notes',
    now: 123
  });
  assert.equal(record.characterCount, 32);
  assert.deepEqual(normalizePdfIndexCacheRecord(record, {
    key: 'v1:2:document', pageCount: 2, indexedPageCount: 2
  }), record);
  assert.equal(normalizePdfIndexCacheRecord(record, {
    key: 'v1:2:document', pageCount: 3, indexedPageCount: 2
  }), null);
});

test('oversized or incomplete PDF indexes are not cached', () => {
  assert.equal(createPdfIndexCacheRecord({
    key: 'v1:2:document',
    pageCount: 2,
    indexedPageCount: 2,
    searchTexts: ['only one page'],
    contextPages: []
  }), null);
  assert.equal(createPdfIndexCacheRecord({
    key: 'v1:1:large',
    pageCount: 1,
    indexedPageCount: 1,
    searchTexts: ['x'.repeat(MAX_CACHED_PDF_INDEX_CHARACTERS + 1)],
    contextPages: []
  }), null);
});
