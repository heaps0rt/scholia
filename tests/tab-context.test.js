import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLikelyPdfTab,
  isPdfUrl,
  pdfSourceStorageKey,
  pdfSourceUrl,
  pdfViewerSourceId,
  safeSourceUrl,
  tabSource
} from '../apps/chrome/src/tab-context.js';

test('PDF URLs are recognized without leaking query credentials to provider context', () => {
  const url = 'https://papers.example/research/report.pdf?signature=secret#page=4';
  assert.equal(isPdfUrl(url), true);
  assert.equal(pdfSourceUrl({ url }), url);
  assert.equal(safeSourceUrl(url), 'https://papers.example/research/report.pdf');
});

test('Chrome PDF viewer URLs are unwrapped for local extraction', () => {
  const source = 'https://example.test/paper.pdf?token=private';
  const viewer = `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?file=${encodeURIComponent(source)}`;
  assert.equal(pdfSourceUrl({ url: viewer }), source);
  assert.deepEqual(tabSource({ id: 7, windowId: 3, title: 'Paper', url: viewer }), {
    tabId: 7,
    windowId: 3,
    pageTitle: 'Paper',
    url: 'https://example.test/paper.pdf',
    pdfUrl: source,
    sourceKind: 'pdf',
    viewerSourceId: ''
  });
});

test('Scholia PDF viewer URLs carry only an opaque source id', () => {
  const viewer = 'chrome-extension://abcdefghijk/pdf-viewer.html?source=12345678-abcd_EF';
  assert.equal(pdfViewerSourceId(viewer), '12345678-abcd_EF');
  assert.equal(pdfSourceStorageKey('12345678-abcd_EF'), 'scholia.pdf-source.v1.12345678-abcd_EF');
  assert.deepEqual(tabSource({ id: 9, windowId: 2, title: 'Paper — Scholia PDF', url: viewer }), {
    tabId: 9,
    windowId: 2,
    pageTitle: 'Paper — Scholia PDF',
    url: '',
    pdfUrl: '',
    sourceKind: 'pdf',
    viewerSourceId: '12345678-abcd_EF'
  });
});

test('a PDF filename in the tab title covers endpoints without a PDF suffix', () => {
  const tab = { title: 'lecture-notes.pdf', url: 'https://files.example/download?id=42' };
  assert.equal(isLikelyPdfTab(tab), true);
  assert.equal(pdfSourceUrl(tab), tab.url);
});

test('ordinary web pages remain page sources', () => {
  assert.deepEqual(tabSource({ id: 4, title: 'Article', url: 'https://example.test/read?utm_source=x#part' }), {
    tabId: 4,
    windowId: null,
    pageTitle: 'Article',
    url: 'https://example.test/read',
    pdfUrl: '',
    sourceKind: 'page',
    viewerSourceId: ''
  });
});
