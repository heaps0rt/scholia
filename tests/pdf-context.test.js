import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractPdfContext, formatPdfContext, readPdfResponse, textContentToString } from '../apps/chrome/src/pdf-context.js';

function onePagePdf(text) {
  const stream = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

test('PDF text items preserve visual lines and sensible word spacing', () => {
  const text = textContentToString([
    { str: 'Scholia', width: 36, transform: [1, 0, 0, 10, 10, 100] },
    { str: 'reads', width: 25, transform: [1, 0, 0, 10, 50, 100] },
    { str: '.', width: 2, transform: [1, 0, 0, 10, 75, 100], hasEOL: true },
    { str: 'Next line', width: 44, transform: [1, 0, 0, 10, 10, 82] }
  ]);
  assert.equal(text, 'Scholia reads.\nNext line');
});

test('PDF context retains explicit page boundaries and a document map', () => {
  const result = formatPdfContext(['Introduction\nFirst paragraph.', '', 'Conclusion']);
  assert.match(result.context, /\[PDF page 1 of 3\]/);
  assert.match(result.context, /\[PDF page 2 of 3\]\n\(No extractable text on this page\.\)/);
  assert.match(result.outline, /PDF page 3: Conclusion/);
  assert.equal(result.pageCount, 3);
  assert.equal(result.extractedCharacters, 'Introduction\nFirst paragraph.'.length + 'Conclusion'.length);
});

test('PDF downloads are assembled from streamed response chunks', async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('%PDF-1.7\n'));
      controller.enqueue(new TextEncoder().encode('body'));
      controller.close();
    }
  }), { headers: { 'content-length': '13' } });
  const progress = [];
  const bytes = await readPdfResponse(response, (value) => progress.push(value.loaded));
  assert.equal(new TextDecoder().decode(bytes), '%PDF-1.7\nbody');
  assert.deepEqual(progress, [9, 13]);
});

test('packaged PDF.js extracts text from an actual PDF document', async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = { runtime: { getURL(path) {
    const relative = path.replace(/^vendor\/pdfjs\//, '');
    const location = relative.startsWith('cmaps/') || relative.startsWith('standard_fonts/')
      ? resolve('node_modules/pdfjs-dist', relative)
      : resolve('node_modules/pdfjs-dist/legacy/build', relative);
    return pathToFileURL(location).href;
  } } };
  try {
    const result = await extractPdfContext(onePagePdf('Scholia PDF context works'));
    assert.equal(result.pageCount, 1);
    assert.equal(result.extractedCharacters, 25);
    assert.match(result.context, /\[PDF page 1 of 1\]\nScholia PDF context works/);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});
