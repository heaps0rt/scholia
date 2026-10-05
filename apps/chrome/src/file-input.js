import { MAX_FILE_TEXT } from '../../../packages/core/src/file-attachments.js';
import { extractPdfContext } from './pdf/pdf-context.js';
import { normalizeImageFile } from './image-input.js';
import { extractOfficeText } from './office-text.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export async function readChatFile(file, { signal } = {}) {
  if (!file?.size) throw new Error(`“${file?.name || 'File'}” is empty.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`“${file.name}” is larger than the 25 MB attachment limit.`);
  const base = { name: file.name || 'Attached file', size: file.size, mimeType: file.type || 'text/plain' };
  if (/\.(docx|pptx|xlsx)$/i.test(file.name)) return { ...base, ...await extractOfficeText(file, MAX_FILE_TEXT) };
  if (String(file.type).startsWith('image/')) {
    return { ...base, imageDataUrl: await normalizeImageFile(file) };
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdf = await extractPdfContext(file, { signal, maxCharacters: MAX_FILE_TEXT });
    if (!pdf.extractedCharacters) throw new Error(`“${file.name}” has no readable text after local OCR. Try a clearer scan or attach page images.`);
    return { ...base, mimeType: 'application/pdf', text: pdf.context.slice(0, MAX_FILE_TEXT), truncated: pdf.truncated || pdf.context.length > MAX_FILE_TEXT };
  }
  const bytes = new Uint8Array(await file.slice(0, MAX_FILE_TEXT * 4 + 4).arrayBuffer());
  let text;
  try {
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    const decoder = new TextDecoder(utf16, { fatal: true });
    text = decoder.decode(bytes, { stream: file.size > bytes.length });
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) throw new Error('Binary file');
  } catch {
    throw new Error(`“${file.name}” could not be read. Attach a PDF, image, DOCX, PPTX, XLSX, or text file (including code, Markdown, CSV, and JSON).`);
  }
  if (!text.trim()) throw new Error(`“${file.name}” has no readable text.`);
  return { ...base, text: text.slice(0, MAX_FILE_TEXT), truncated: text.length > MAX_FILE_TEXT || file.size > bytes.length };
}
