export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_EXTRACTED_CHARACTERS = 8_000_000;
export const MAX_EXTRACTED_PAGES = 5_000;

function compactLine(value) {
  return String(value || '').replace(/[\t\f\v ]+/g, ' ').trim();
}

function needsSpace(left, right, gap, fontSize) {
  if (!left || !right || /\s$/.test(left) || /^\s/.test(right)) return false;
  if (/^[,.;:!?%)\]}]/.test(right) || /[(\[{/]$/.test(left)) return false;
  if (Number.isFinite(gap)) return gap > Math.max(0.8, fontSize * 0.08);
  return true;
}

export function textContentToString(items = []) {
  const lines = [];
  let line = '';
  let previous = null;

  const flush = () => {
    const clean = compactLine(line);
    if (clean) lines.push(clean);
    line = '';
    previous = null;
  };

  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    const text = item.str.replace(/\s+/g, ' ');
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4]);
    const y = Number(transform[5]);
    const fontSize = Math.max(1, Math.abs(Number(transform[3])) || Number(item.height) || 10);
    const changedLine = previous
      && Number.isFinite(y)
      && Number.isFinite(previous.y)
      && Math.abs(y - previous.y) > Math.max(fontSize, previous.fontSize) * 0.45;
    if (changedLine) flush();

    const gap = previous && Number.isFinite(x) && Number.isFinite(previous.endX)
      ? x - previous.endX
      : Number.NaN;
    if (needsSpace(line, text, gap, fontSize)) line += ' ';
    line += text;

    previous = {
      y,
      fontSize,
      endX: Number.isFinite(x) ? x + (Number(item.width) || 0) : Number.NaN
    };
    if (item.hasEOL) flush();
  }
  flush();
  return lines.join('\n');
}

function pageSummary(text) {
  const first = String(text || '').split('\n').map(compactLine).find(Boolean) || 'No extractable text';
  return first.length <= 160 ? first : `${first.slice(0, 157).trimEnd()}…`;
}

export function formatPdfContext(pages = [], totalPages = pages.length) {
  const total = Math.max(pages.length, Number(totalPages) || 0);
  const normalizedPages = pages.map((page) => String(page || '').trim());
  const omitted = total > normalizedPages.length
    ? `\n\n[PDF extraction stopped after page ${normalizedPages.length} of ${total} at Scholia's local safety limit.]`
    : '';
  return {
    context: normalizedPages
      .map((text, index) => `[PDF page ${index + 1} of ${total}]\n${text || '(No extractable text on this page.)'}`)
      .join('\n\n') + omitted,
    outline: normalizedPages
      .map((text, index) => `- PDF page ${index + 1}: ${pageSummary(text)}`)
      .concat(total > normalizedPages.length ? [`- PDF pages ${normalizedPages.length + 1}–${total}: omitted at local safety limit`] : [])
      .join('\n'),
    pageCount: total,
    extractedPageCount: normalizedPages.length,
    extractedCharacters: normalizedPages.reduce((sum, text) => sum + text.length, 0)
  };
}

export async function readPdfResponse(response, onProgress = () => {}) {
  if (!response.ok) throw new Error(`The PDF could not be downloaded (HTTP ${response.status}).`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    throw new Error('This PDF is larger than Scholia\'s 100 MB local-processing limit.');
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PDF_BYTES) throw new Error('This PDF is larger than Scholia\'s 100 MB local-processing limit.');
    return new Uint8Array(buffer);
  }

  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_PDF_BYTES) {
      await reader.cancel();
      throw new Error('This PDF is larger than Scholia\'s 100 MB local-processing limit.');
    }
    chunks.push(value);
    onProgress({ phase: 'download', loaded: received, total: declaredLength || 0 });
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function looksLikePdf(bytes) {
  const prefix = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(1024, bytes.length)));
  return prefix.includes('%PDF-');
}

export async function fetchPdfBytes(url, { signal, onProgress } = {}) {
  let response;
  try {
    response = await fetch(url, { credentials: 'include', cache: 'force-cache', signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error('Scholia could not read this PDF URL. If it is local or access-controlled, choose the PDF file from the side panel.');
  }
  const bytes = await readPdfResponse(response, onProgress);
  if (!looksLikePdf(bytes)) {
    throw new Error('The document URL did not return PDF data. Choose the PDF file from the side panel instead.');
  }
  return bytes;
}

export async function extractPdfContext(bytes, { onProgress = () => {}, signal, password = '' } = {}) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (!looksLikePdf(bytes)) throw new Error('The selected file is not a readable PDF.');

  const pdfjs = await import(chrome.runtime.getURL('vendor/pdfjs/pdf.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');
  const assetRoot = chrome.runtime.getURL('vendor/pdfjs/');
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    password: password || undefined,
    cMapUrl: `${assetRoot}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetRoot}standard_fonts/`,
    isEvalSupported: false,
    useSystemFonts: true
  });

  const abort = () => loadingTask.destroy();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await loadingTask.promise;
    const pages = [];
    let extractedCharacters = 0;
    const pagesToRead = Math.min(pdf.numPages, MAX_EXTRACTED_PAGES);
    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      if (signal?.aborted) throw new DOMException('PDF extraction was cancelled.', 'AbortError');
      if (extractedCharacters >= MAX_EXTRACTED_CHARACTERS) break;
      const page = await pdf.getPage(pageNumber);
      const text = textContentToString((await page.getTextContent()).items);
      const room = MAX_EXTRACTED_CHARACTERS - extractedCharacters;
      pages.push(room > 0 ? text.slice(0, room) : '');
      extractedCharacters += Math.min(text.length, Math.max(0, room));
      page.cleanup();
      onProgress({ phase: 'extract', page: pageNumber, total: pdf.numPages });
    }
    let metadata = {};
    try { metadata = (await pdf.getMetadata()).info || {}; } catch {}
    const formatted = formatPdfContext(pages, pdf.numPages);
    return {
      ...formatted,
      title: compactLine(metadata.Title || '').slice(0, 500),
      truncated: formatted.extractedPageCount < formatted.pageCount
        || formatted.extractedCharacters >= MAX_EXTRACTED_CHARACTERS
    };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('PDF extraction was cancelled.', 'AbortError');
    if (error?.name === 'PasswordException') {
      throw new Error('This PDF is password-protected. Unlock it first, then choose an unlocked copy from the side panel.');
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    await loadingTask.destroy().catch(() => {});
  }
}
