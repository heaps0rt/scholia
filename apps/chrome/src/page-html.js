export const MAX_PAGE_HTML_CHARACTERS = 500_000;
export const MAX_PAGE_HTML_NODES = 40_000;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;
const DOCUMENT_FRAGMENT_NODE = 11;
const OMITTED_ELEMENTS = new Set(['script', 'style', 'svg', 'canvas']);
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr'
]);
const PRESERVE_WHITESPACE_ELEMENTS = new Set(['pre', 'code', 'samp', 'kbd']);
const FORM_VALUE_ELEMENTS = new Set(['input', 'textarea']);
const OMITTED_ATTRIBUTES = new Set(['nonce', 'srcdoc', 'style']);
const URL_ATTRIBUTES = new Set(['action', 'cite', 'formaction', 'href', 'poster', 'src']);
const MAX_ATTRIBUTE_CHARACTERS = 512;
const MAX_ATTRIBUTES_PER_ELEMENT = 48;
const TRUNCATED_MARKER = '\n<!-- Scholia HTML snapshot truncated -->';

function escapeText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

function safeTagName(node) {
  const candidate = String(node?.localName || node?.tagName || '').toLowerCase();
  return /^[a-z][a-z0-9._:-]*$/.test(candidate) ? candidate : '';
}

function safeUrlAttribute(value, baseUrl = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(?:data|blob):/i.test(raw)) return '[inline URL omitted]';
  if (/^(?:javascript|vbscript):/i.test(raw)) return '[active URL omitted]';
  try {
    const url = new URL(raw, baseUrl || undefined);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.username = '';
      url.password = '';
      return url.href;
    }
  } catch {}
  return raw;
}

function sanitizedAttribute(element, attribute, baseUrl) {
  const name = String(attribute?.name || '').toLowerCase();
  if (!name || name.startsWith('on') || OMITTED_ATTRIBUTES.has(name)) return null;
  const tag = safeTagName(element);
  if (name === 'value' && FORM_VALUE_ELEMENTS.has(tag)) return null;

  let value = String(attribute?.value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (name === 'srcset' && /(?:^|[\s,])(?:data|blob):/i.test(value)) value = '[inline image sources omitted]';
  else if (URL_ATTRIBUTES.has(name)) value = safeUrlAttribute(value, baseUrl);
  if (value.length > MAX_ATTRIBUTE_CHARACTERS) value = `${value.slice(0, MAX_ATTRIBUTE_CHARACTERS - 1)}…`;
  return value ? `${name}="${escapeAttribute(value)}"` : name;
}

function childNodes(node) {
  if (safeTagName(node) === 'template' && node.content?.childNodes) return node.content.childNodes;
  return node?.childNodes || [];
}

export function sanitizedPageHtml(root = globalThis.document?.documentElement, {
  maxChars = MAX_PAGE_HTML_CHARACTERS,
  maxNodes = MAX_PAGE_HTML_NODES,
  baseUrl = root?.ownerDocument?.baseURI || globalThis.location?.href || ''
} = {}) {
  if (!root) return '';
  const limit = Math.max(256, Math.floor(Number(maxChars) || MAX_PAGE_HTML_CHARACTERS));
  const nodeLimit = Math.max(1, Math.floor(Number(maxNodes) || MAX_PAGE_HTML_NODES));
  const contentLimit = Math.max(1, limit - TRUNCATED_MARKER.length);
  const output = [];
  let length = 0;
  let visited = 0;
  let truncated = false;

  const append = (value) => {
    if (truncated || !value) return !truncated;
    const text = String(value);
    const room = contentLimit - length;
    if (text.length <= room) {
      output.push(text);
      length += text.length;
      return true;
    }
    if (room > 0) {
      output.push(text.slice(0, room));
      length += room;
    }
    truncated = true;
    return false;
  };

  const visit = (node, preserveWhitespace = false) => {
    if (!node || truncated) return;
    if (node.nodeType === TEXT_NODE) {
      const raw = String(node.nodeValue ?? node.textContent ?? '');
      const text = preserveWhitespace
        ? raw.replace(/\r\n?/g, '\n')
        : raw.replace(/\s+/g, ' ');
      append(escapeText(text));
      return;
    }
    if (node.nodeType === DOCUMENT_NODE || node.nodeType === DOCUMENT_FRAGMENT_NODE) {
      for (const child of childNodes(node)) visit(child, preserveWhitespace);
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;

    const tag = safeTagName(node);
    if (!tag || OMITTED_ELEMENTS.has(tag) || String(node.id || '') === 'scholia-extension-root') return;
    visited += 1;
    if (visited > nodeLimit) {
      truncated = true;
      return;
    }

    const attributes = [];
    for (const attribute of Array.from(node.attributes || []).slice(0, MAX_ATTRIBUTES_PER_ELEMENT)) {
      const safe = sanitizedAttribute(node, attribute, baseUrl);
      if (safe) attributes.push(safe);
    }
    if (!append(`<${tag}${attributes.length ? ` ${attributes.join(' ')}` : ''}>`)) return;
    if (VOID_ELEMENTS.has(tag)) return;

    const preserveChildren = preserveWhitespace || PRESERVE_WHITESPACE_ELEMENTS.has(tag);
    for (const child of childNodes(node)) visit(child, preserveChildren);
    append(`</${tag}>`);
  };

  visit(root);
  if (truncated) output.push(TRUNCATED_MARKER);
  return output.join('').slice(0, limit).trim();
}

export function pageContextWithHtml(renderedText = '', html = '') {
  const rendered = String(renderedText || '').trim();
  const snapshot = String(html || '').trim();
  const parts = [];
  if (rendered) {
    parts.push(
      'Live page text (rendered content plus dynamically inserted semantic, open shadow, embedded-document, and accessible image-label text when available):',
      '<scholia-rendered-page>',
      rendered,
      '</scholia-rendered-page>'
    );
  }
  if (snapshot) {
    if (parts.length) parts.push('');
    parts.push(
      'Sanitized page DOM HTML (inert reference; active code, styles, live form values, and large inline URLs are omitted):',
      '<scholia-page-html>',
      snapshot,
      '</scholia-page-html>'
    );
  }
  return parts.join('\n');
}
