import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPdfSemanticIndex,
  findPdfMatches,
  findPdfSemanticMatches,
  pdfMatchItemSegments
} from '../apps/chrome/src/pdf-search.js';

test('PDF search finds literal, case-insensitive phrases across pages', () => {
  const result = findPdfMatches([
    'First Needle phrase.',
    'No match here.',
    'Another needle\nphrase and needle phrase.'
  ], '  NEEDLE   phrase ');

  assert.deepEqual(result, {
    matches: [
      { pageIndex: 0, start: 6, length: 13 },
      { pageIndex: 2, start: 8, length: 13 },
      { pageIndex: 2, start: 26, length: 13 }
    ],
    truncated: false
  });
});

test('PDF search treats punctuation as text rather than a regular expression', () => {
  assert.deepEqual(findPdfMatches(['a+b and aaab'], 'a+b').matches, [
    { pageIndex: 0, start: 0, length: 3 }
  ]);
});

test('PDF search maps a cross-span match back to selectable text items', () => {
  assert.deepEqual(pdfMatchItemSegments(['A ', 'needle', ' phrase', '.'], 2, 13), [
    { itemIndex: 1, start: 0, end: 6 },
    { itemIndex: 2, start: 0, end: 7 }
  ]);
});

test('PDF search reports its result safety cap', () => {
  const result = findPdfMatches(['x x x x'], 'x', 2);
  assert.equal(result.matches.length, 2);
  assert.equal(result.truncated, true);
});

test('semantic PDF search ranks conceptually related pages without an exact phrase', () => {
  const pages = [
    'Photosynthesis converts sunlight into chemical energy that a plant can retain.',
    'A wall socket supplies electrical power to household appliances.',
    'The appendix lists botanical names alphabetically.'
  ];
  const index = buildPdfSemanticIndex(pages);
  const result = findPdfSemanticMatches(pages, 'How do plants store solar power?', index);

  assert.equal(result.matches[0].pageIndex, 0);
  assert.ok(result.matches[0].score > result.matches[1].score);
  assert.match(result.matches[0].excerpt, /Photosynthesis|sunlight|energy|plant/i);
  assert.ok(result.matches[0].length > 0);
});

test('semantic PDF search normalizes inflections, spelling, and Norwegian concept aliases', () => {
  const pages = [
    'Metoden har flere begrensninger og en viktig ulempe.',
    'Resultatene viser en liten forbedring.'
  ];
  const result = findPdfSemanticMatches(pages, 'Hva er svakhetene ved denne metoden?');
  assert.equal(result.matches[0].pageIndex, 0);
});
