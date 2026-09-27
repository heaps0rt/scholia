import { parentPort, workerData } from 'node:worker_threads';
import { extname } from 'node:path';
import { safePlainText, unreadablePageCount } from './document-formats.js';
import { DOMParser } from 'linkedom';
import { extractOfficeText } from '../chrome/src/office-text.js';
globalThis.DOMParser = DOMParser;
const { name, data } = workerData,
  bytes = new Uint8Array(data),
  ext = extname(name).slice(1).toLowerCase();
try {
  let kind = 'text',
    notice = '',
    pages = [],
    images = {};
  const textPages = (text) =>
    Array.from({ length: Math.max(1, Math.ceil(text.length / 14000)) }, (_, i) => ({
      number: i + 1,
      text: text.slice(i * 14000, (i + 1) * 14000),
    }));
  if (ext === 'pdf') {
    kind = 'pdf';
    const canvas = await import('@napi-rs/canvas');
    globalThis.DOMMatrix = canvas.DOMMatrix;
    globalThis.Path2D = canvas.Path2D;
    globalThis.ImageData = canvas.ImageData;
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({
      data: bytes,
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true,
    });
    const pdf = await loading.promise;
    if (pdf.numPages > 2000)
      throw new Error('This PDF exceeds 2,000 pages. Split it into smaller documents.');
    let count = 0,
      unreadable = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number),
        content = await page.getTextContent();
      const text = content.items.map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('');
      count += text.length;
      if (count > 8_000_000)
        throw new Error('The extracted document text exceeds the index limit.');
      if (!text.trim()) unreadable++;
      pages.push({ number, text });
      page.cleanup();
    }
    if (unreadable)
      notice = `${unreadable} pages contain no selectable text. They remain readable in the PDF viewer; select a figure to discuss them.`;
    await pdf.destroy();
  } else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    kind = 'image';
    pages = [{ number: 1, text: '' }];
  } else if (['docx', 'pptx', 'xlsx'].includes(ext)) {
    kind = 'office';
    const extracted = await extractOfficeText(new Blob([bytes]), 8_000_000);
    pages = textPages(extracted.text);
    if (extracted.truncated) notice = 'Only the first 8 million characters were indexed.';
  } else if (ext === 'ipynb') {
    kind = 'notebook';
    const notebook = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (!Array.isArray(notebook.cells) || notebook.cells.length > 10000)
      throw new Error('Invalid or oversized notebook.');
    let textLength = 0,
      imageBytes = 0;
    pages = notebook.cells.map((cell, i) => {
      const source = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
      let text = cell.cell_type === 'code' ? `\`\`\`\n${source}\n\`\`\`` : source;
      const names = [];
      for (const [j, output] of (cell.outputs || []).entries()) {
        const plain = output.text || output.data?.['text/plain'];
        if (plain) text += '\n\n' + (Array.isArray(plain) ? plain.join('') : plain);
        const image = output.data?.['image/png'];
        if (image) {
          const encoded = Array.isArray(image) ? image.join('') : String(image);
          imageBytes += encoded.length;
          if (encoded.length > 14_000_000 || imageBytes > 40_000_000)
            throw new Error(
              'The notebook contains too much image output. Clear large outputs before importing.'
            );
          const name = `cell-${i}-${j}.png`;
          images[name] = encoded;
          names.push(name);
        }
      }
      textLength += text.length;
      if (textLength > 8_000_000) throw new Error('The notebook text exceeds the index limit.');
      return { number: i + 1, text, images: names };
    });
    if (!pages.length) pages = [{ number: 1, text: '' }];
  } else if (
    [
      'md',
      'txt',
      'csv',
      'tsv',
      'json',
      'xml',
      'html',
      'py',
      'r',
      'jl',
      'js',
      'ts',
      'java',
      'c',
      'cpp',
      'h',
      'm',
      'sh',
      'sql',
      'yaml',
      'yml',
      'tex',
      'log',
    ].includes(ext)
  ) {
    kind = ['md', 'txt'].includes(ext) ? 'text' : 'code';
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.length > 8_000_000) throw new Error('The text exceeds the index limit.');
    pages = textPages(text).map((page) => ({
      ...page,
      text: kind === 'code' ? `\`\`\`\n${page.text}\n\`\`\`` : page.text,
    }));
  } else {
    // Scientific inputs often have project-specific extensions, such as .nanowire or .eam.
    // Decode the complete bounded file; a printable prefix alone cannot identify binary data.
    const text = safePlainText(bytes, ext);
    if (text !== null) {
      kind = 'code';
      pages = textPages(text).map((page) => ({ ...page, text: `\`\`\`\n${page.text}\n\`\`\`` }));
    } else {
      kind = 'preview';
      pages = [{ number: 1, text: '' }];
      notice =
        'The original is saved, but no readable text was indexed. Download it to open in a compatible application.';
    }
  }
  const unreadablePages = unreadablePageCount(pages);
  parentPort.postMessage({ kind, notice, pages, images, unreadablePages });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
