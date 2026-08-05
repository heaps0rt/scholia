import { createHtmlElement } from './html-elements.js';

const MAX_SELECTION_LENGTH = 12_000;
const MAX_IMAGE_EDGE = 1_800;

const IGNORED_MATH_CODEPOINTS = new Set([
  0x2061, 0x2062, 0x2063, 0x2064, 0x200b, 0x2060, 0xfeff, 0x00a0, 0x2009
]);
const LEAF_MATH_TYPES = new Set(['mi', 'mo', 'mn', 'mtext', 'ms']);
const LEAF_MATH_SELECTOR = [...LEAF_MATH_TYPES]
  .map((type) => `g[data-mml-node="${type}"]`)
  .join(', ');

export function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function embeddedSourceUrl() {
  if (document.documentElement?.dataset?.scholiaPdfViewer !== 'true') return '';
  return String(document.documentElement.dataset.scholiaSourceUrl || '');
}

function normalizePageText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sourceUrl() {
  try {
    const url = new URL(embeddedSourceUrl() || location.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return location.origin + location.pathname;
  }
}

export function currentSiteKey() {
  let url;
  try { url = new URL(embeddedSourceUrl() || location.href); } catch { return location.protocol.toLowerCase(); }
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname.toLowerCase();
  if (url.protocol === 'file:') return 'file://';
  return url.protocol.toLowerCase();
}

function isEditable(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return Boolean(element?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function mathIsDisplay(container) {
  return container?.getAttribute?.('display') === 'block'
    || container?.getAttribute?.('data-tex-display') === 'true'
    || container?.closest?.('.katex-display') != null;
}

export function mathContainer(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  if (!element?.closest) return null;
  return element.closest('mjx-container, .katex, math');
}

function extractTex(container) {
  if (!container) return '';
  const direct = container.getAttribute?.('data-tex') || container.getAttribute?.('alttext');
  if (direct) return direct.trim();

  const annotation = container.querySelector?.(
    'annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"]'
  );
  if (annotation?.textContent) return annotation.textContent.trim();

  const math = container.matches?.('math') ? container : container.querySelector?.('math');
  return (math?.getAttribute?.('alttext') || container.getAttribute?.('aria-label') || '').trim();
}

function normalizeMathCharacter(character) {
  const codepoint = character.codePointAt(0);
  if (codepoint === 0x2212) return '-';
  if (codepoint === 0x22c5) return '·';
  if (codepoint >= 0x239b && codepoint <= 0x239d) return '(';
  if (codepoint >= 0x239e && codepoint <= 0x23a0) return ')';
  if (codepoint >= 0x23a1 && codepoint <= 0x23a3) return '[';
  if (codepoint >= 0x23a4 && codepoint <= 0x23a6) return ']';
  if (codepoint === 0x23aa) return '';
  try {
    return character.normalize('NFKD');
  } catch {
    return character;
  }
}

function decodeMathGlyphs(node) {
  let output = '';
  for (const glyph of node?.querySelectorAll?.('[data-c]') || []) {
    const codepoint = Number.parseInt(glyph.getAttribute('data-c'), 16);
    if (!codepoint || IGNORED_MATH_CODEPOINTS.has(codepoint)) continue;
    output += normalizeMathCharacter(String.fromCodePoint(codepoint));
  }
  return collapseWhitespace(output);
}

function parenthesize(value) {
  const clean = String(value || '').trim();
  return clean.length > 1 && !/^\(.*\)$/.test(clean) ? `(${clean})` : clean;
}

export function directMathChildren(node) {
  try {
    return [...node.querySelectorAll(':scope > g[data-mml-node]')];
  } catch {
    return [];
  }
}

export function decodeMathNode(node) {
  if (!node?.getAttribute) return '';
  const type = node.getAttribute('data-mml-node');
  try {
    if (!type || LEAF_MATH_TYPES.has(type)) return decodeMathGlyphs(node);
    const children = directMathChildren(node);
    if (type === 'mfrac') {
      return `${parenthesize(decodeMathNode(children[0]))}/${parenthesize(decodeMathNode(children[1]))}`;
    }
    if (type === 'msup') return `${decodeMathNode(children[0])}^${parenthesize(decodeMathNode(children[1]))}`;
    if (type === 'msub') return `${decodeMathNode(children[0])}_${parenthesize(decodeMathNode(children[1]))}`;
    if (type === 'msubsup') {
      return `${decodeMathNode(children[0])}_${parenthesize(decodeMathNode(children[1]))}^${parenthesize(decodeMathNode(children[2]))}`;
    }
    if (type === 'msqrt') {
      const body = children
        .filter((child) => child.getAttribute('data-mml-node') !== 'mo')
        .map(decodeMathNode)
        .join('');
      return `sqrt(${body})`;
    }
    if (type === 'mroot') return `root[${decodeMathNode(children[1])}](${decodeMathNode(children[0])})`;
    if (type === 'munder' || type === 'mover' || type === 'munderover') return decodeMathNode(children[0]);
    return children.map(decodeMathNode).join('') || decodeMathGlyphs(node);
  } catch {
    return decodeMathGlyphs(node);
  }
}

export function mathChain(container, target) {
  if (!container?.matches?.('mjx-container')) return [];
  const chain = [];
  let node = target?.closest?.('g[data-mml-node]');
  while (node && container.contains(node)) {
    if (node.getAttribute('data-mml-node') !== 'math' && decodeMathNode(node)) chain.push(node);
    node = node.parentElement?.closest?.('g[data-mml-node]');
  }
  return [...new Set(chain)];
}

export function leafMathNodes(container) {
  return [...container?.querySelectorAll?.(LEAF_MATH_SELECTOR) || []];
}

function mathNodeAtPoint(container, x, y) {
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const node of leafMathNodes(container)) {
    const rect = node.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return node;

    const dx = rect.left + rect.width / 2 - x;
    const dy = rect.top + rect.height / 2 - y;
    const distance = dx * dx + dy * dy;
    if (distance < closestDistance) {
      closest = node;
      closestDistance = distance;
    }
  }
  return closest;
}

export function chainAtPoint(container, target, x, y) {
  const direct = mathChain(container, target);
  if (direct.length || !container?.matches?.('mjx-container')) return direct;
  const nearest = mathNodeAtPoint(container, x, y);
  return nearest ? mathChain(container, nearest) : [];
}

export function wrappedMath(container) {
  const tex = extractTex(container) || decodeMathGlyphs(container);
  if (!tex) return '';
  return mathIsDisplay(container) ? `$$${tex}$$` : `$${tex}$`;
}

function selectionTextWithMath(range, selection) {
  let fragment;
  try {
    fragment = range.cloneContents();
  } catch {
    return collapseWhitespace(selection.toString());
  }

  const containers = [...fragment.querySelectorAll?.('mjx-container, .katex, math') || []]
    .filter((element) => !element.parentElement?.closest?.('mjx-container, .katex, math'));
  for (const container of containers) {
    const tex = extractTex(container);
    if (!tex) continue;
    const wrapped = mathIsDisplay(container) ? `$$${tex}$$` : `$${tex}$`;
    container.replaceWith(document.createTextNode(wrapped));
  }
  return collapseWhitespace(fragment.textContent) || collapseWhitespace(selection.toString());
}

export function pageContext() {
  const extensionHost = document.getElementById('scholia-extension-root');
  const previousDisplay = extensionHost?.style.getPropertyValue('display') || '';
  const previousPriority = extensionHost?.style.getPropertyPriority('display') || '';
  if (extensionHost) extensionHost.style.setProperty('display', 'none', 'important');
  try {
    const renderedText = document.body?.innerText || document.documentElement?.innerText || '';
    return normalizePageText(renderedText);
  } finally {
    if (extensionHost) {
      if (previousDisplay) extensionHost.style.setProperty('display', previousDisplay, previousPriority);
      else extensionHost.style.removeProperty('display');
    }
  }
}

export function pageOutline() {
  const seen = new Set();
  const lines = [];
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
  for (const heading of headings) {
    const text = collapseWhitespace(heading.innerText).slice(0, 240);
    if (!text) continue;
    const tagLevel = /^H([1-6])$/.exec(heading.tagName)?.[1];
    const level = Math.min(6, Math.max(1, Number(tagLevel || heading.getAttribute('aria-level')) || 2));
    const key = `${level}:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${'  '.repeat(level - 1)}- ${text}`);
  }
  return lines.join('\n');
}

export function lastRangeRect(range) {
  const rects = range.getClientRects();
  const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  return rect && (rect.width || rect.height) ? rect : null;
}

export function pageMetadata() {
  return {
    context: pageContext(),
    outline: pageOutline(),
    pageTitle: document.title,
    url: sourceUrl(),
    pageLanguage: document.documentElement.lang || navigator.language,
    imageDataUrl: ''
  };
}

export async function resolvedPageMetadata() {
  const resolver = document.documentElement?.dataset?.scholiaPdfViewer === 'true'
    ? globalThis.__scholiaGetPageMetadata
    : null;
  if (typeof resolver !== 'function') return pageMetadata();
  const metadata = await resolver();
  return {
    context: String(metadata?.context || ''),
    outline: String(metadata?.outline || ''),
    pageTitle: String(metadata?.pageTitle || document.title),
    url: String(metadata?.url || sourceUrl()),
    pageLanguage: String(metadata?.pageLanguage || document.documentElement.lang || navigator.language),
    imageDataUrl: String(metadata?.imageDataUrl || '')
  };
}

export function currentSelectionCapture(forcedText = '', selection = window.getSelection()) {
  const forcedSelection = collapseWhitespace(forcedText);
  if (forcedSelection) {
    return {
      kind: 'text',
      selection: forcedSelection.slice(0, MAX_SELECTION_LENGTH),
      preview: forcedSelection,
      rect: null
    };
  }
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  if (isEditable(selection.anchorNode) || isEditable(selection.focusNode)) return null;

  const range = selection.getRangeAt(0);
  const text = selectionTextWithMath(range, selection);
  if (!text) return null;
  return {
    kind: /\$[^$]+\$/.test(text) ? 'latex' : 'text',
    selection: text.slice(0, MAX_SELECTION_LENGTH),
    preview: text,
    rect: lastRangeRect(range),
    range: range.cloneRange()
  };
}

export function cropScreenshot(dataUrl, rect) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scaleX = image.naturalWidth / window.innerWidth;
        const scaleY = image.naturalHeight / window.innerHeight;
        const sourceX = Math.max(0, Math.round(rect.left * scaleX));
        const sourceY = Math.max(0, Math.round(rect.top * scaleY));
        const sourceWidth = Math.min(
          image.naturalWidth - sourceX,
          Math.max(1, Math.round(rect.width * scaleX))
        );
        const sourceHeight = Math.min(
          image.naturalHeight - sourceY,
          Math.max(1, Math.round(rect.height * scaleY))
        );
        const outputScale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight));
        const canvas = createHtmlElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
        canvas.height = Math.max(1, Math.round(sourceHeight * outputScale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas rendering is unavailable on this page.');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          canvas.width,
          canvas.height
        );
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error('Chrome returned an unreadable screenshot.'));
    image.src = dataUrl;
  });
}
