import {
  COMPACT_PACKED_CONTEXT_CHARS,
  packPageContext
} from '../../../packages/core/src/context.js';

/** Builds a fresh, question-focused context pack for every selection turn. */
export function selectionContextForQuestion(capture, question, {
  includePageContext = true,
  maxChars = COMPACT_PACKED_CONTEXT_CHARS
} = {}) {
  if (!includePageContext) return '';
  const source = String(capture?.context || capture?.packedContext || '');
  if (!source.trim()) return '';
  return packPageContext(source, {
    outline: capture?.outline,
    selection: capture?.preview || capture?.selection,
    question,
    maxChars: Number.isFinite(maxChars) ? maxChars : COMPACT_PACKED_CONTEXT_CHARS,
    scopeDescription: capture?.pdfLocalContext
      ? 'the selected PDF page neighborhood'
      : capture?.kind === 'mail'
      ? 'the selected private email thread'
      : capture?.htmlContextCharacters
        ? 'the live page text and its sanitized DOM HTML snapshot'
        : 'the complete live page text'
  });
}
