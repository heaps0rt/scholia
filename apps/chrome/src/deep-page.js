export const MAX_DEEP_PAGE_TILES = 24;
export const MAX_LIVE_PAGE_TEXT_CHARACTERS = 1_000_000;

const MAX_SHADOW_ROOTS = 96;
const MAX_EMBEDDED_DOCUMENTS = 24;
const MAX_IMAGE_DESCRIPTIONS = 320;
const DEEP_PAGE_SETTLE_MS = 170;

function normalizedText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactText(value) {
  return normalizedText(value).replace(/\s+/g, ' ').toLowerCase();
}

function safeLabel(value) {
  return String(value || '').replace(/[\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function mergePageTextSources(sources = [], {
  maxChars = MAX_LIVE_PAGE_TEXT_CHARACTERS
} = {}) {
  const limit = Math.max(1_000, Math.floor(Number(maxChars) || MAX_LIVE_PAGE_TEXT_CHARACTERS));
  const parts = [];
  let comparable = '';
  let used = 0;

  for (const [index, source] of Array.from(sources || []).entries()) {
    const text = normalizedText(typeof source === 'string' ? source : source?.text);
    if (!text) continue;
    const candidate = compactText(text);
    if (candidate && comparable.includes(candidate)) continue;

    const label = index > 0 && typeof source === 'object' ? safeLabel(source?.label) : '';
    const prefix = label ? `[${label}]\n` : '';
    const separator = parts.length ? '\n\n' : '';
    const room = limit - used - separator.length - prefix.length;
    if (room <= 0) break;
    const clipped = text.length > room
      ? `${text.slice(0, Math.max(0, room - 1)).trimEnd()}…`
      : text;
    if (!clipped) break;
    parts.push(`${prefix}${clipped}`);
    used += separator.length + prefix.length + clipped.length;
    comparable = `${comparable} ${compactText(clipped)}`.trim();
    if (used >= limit) break;
  }

  return parts.join('\n\n').slice(0, limit).trim();
}

function rootText(root) {
  return normalizedText(root?.innerText || root?.textContent || '');
}

function topLevelSemanticRoots(documentValue) {
  const selector = 'article, main, [role="article"], [role="main"]';
  const roots = Array.from(documentValue?.querySelectorAll?.(selector) || []);
  return roots.filter((root) => !roots.some((candidate) => candidate !== root && candidate.contains?.(root)));
}

function openShadowRoots(documentValue) {
  const found = [];
  const scanned = new Set();
  const roots = [documentValue?.documentElement].filter(Boolean);
  while (roots.length && found.length < MAX_SHADOW_ROOTS) {
    const root = roots.shift();
    if (!root || scanned.has(root)) continue;
    scanned.add(root);
    for (const element of Array.from(root.querySelectorAll?.('*') || [])) {
      const shadow = element?.shadowRoot;
      if (!shadow || scanned.has(shadow)) continue;
      found.push(shadow);
      roots.push(shadow);
      if (found.length >= MAX_SHADOW_ROOTS) break;
    }
  }
  return found;
}

function accessibleFrameDocuments(documentValue) {
  const found = [];
  const scanned = new Set([documentValue]);
  const queue = [documentValue];
  while (queue.length && found.length < MAX_EMBEDDED_DOCUMENTS) {
    const current = queue.shift();
    for (const frame of Array.from(current?.querySelectorAll?.('iframe, frame') || [])) {
      let embedded;
      try { embedded = frame.contentDocument; } catch { embedded = null; }
      if (!embedded?.documentElement || scanned.has(embedded)) continue;
      scanned.add(embedded);
      found.push(embedded);
      queue.push(embedded);
      if (found.length >= MAX_EMBEDDED_DOCUMENTS) break;
    }
  }
  return found;
}

function imageDescriptions(documentValue) {
  const lines = [];
  const seen = new Set();
  for (const image of Array.from(documentValue?.querySelectorAll?.('img, input[type="image"]') || [])) {
    const alt = String(image.getAttribute?.('alt') || image.getAttribute?.('aria-label') || image.getAttribute?.('title') || '').trim();
    const caption = String(image.closest?.('figure')?.querySelector?.('figcaption')?.innerText || '').trim();
    const description = normalizedText([alt, caption && caption !== alt ? caption : ''].filter(Boolean).join(' — '));
    if (!description) continue;
    const key = compactText(description);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    lines.push(`Image ${lines.length + 1}: ${description.slice(0, 800)}`);
    if (lines.length >= MAX_IMAGE_DESCRIPTIONS) break;
  }
  return lines.join('\n');
}

function ariaOnlyDescriptions(documentValue, renderedText) {
  const rendered = compactText(renderedText);
  const labels = [];
  const seen = new Set();
  for (const element of Array.from(documentValue?.querySelectorAll?.('[aria-label]') || [])) {
    const label = normalizedText(element.getAttribute?.('aria-label') || '');
    if (!label || label.length > 500) continue;
    const key = compactText(label);
    if (!key || rendered.includes(key) || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= 160) break;
  }
  return labels.join('\n');
}

export function collectLivePageText(documentValue = globalThis.document) {
  if (!documentValue) return '';
  const rendered = rootText(documentValue.body || documentValue.documentElement);
  const renderedComparable = compactText(rendered);
  const sources = [{ text: rendered }];

  for (const root of topLevelSemanticRoots(documentValue)) {
    const semantic = rootText(root);
    const comparable = compactText(semantic);
    if (comparable && !renderedComparable.includes(comparable)) {
      sources.push({ label: 'Additional live DOM text', text: semantic });
    }
  }

  for (const [index, root] of openShadowRoots(documentValue).entries()) {
    sources.push({ label: `Open shadow content ${index + 1}`, text: rootText(root) });
  }

  for (const [index, embedded] of accessibleFrameDocuments(documentValue).entries()) {
    const title = safeLabel(embedded.title) || `Embedded document ${index + 1}`;
    sources.push({ label: `Embedded document: ${title}`, text: rootText(embedded.body || embedded.documentElement) });
    for (const [shadowIndex, root] of openShadowRoots(embedded).entries()) {
      sources.push({ label: `Embedded open shadow content ${index + 1}.${shadowIndex + 1}`, text: rootText(root) });
    }
  }

  sources.push({ label: 'Image descriptions', text: imageDescriptions(documentValue) });
  sources.push({ label: 'Accessible labels not present in rendered text', text: ariaOnlyDescriptions(documentValue, rendered) });
  return mergePageTextSources(sources);
}

function finiteDimension(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

export function deepPageScrollPlan(pageHeight, viewportHeight, maxTiles = MAX_DEEP_PAGE_TILES) {
  const height = finiteDimension(pageHeight);
  const viewport = finiteDimension(viewportHeight);
  const tileLimit = Math.max(1, Math.floor(Number(maxTiles) || MAX_DEEP_PAGE_TILES));
  const maximumScroll = Math.max(0, height - viewport);
  if (!maximumScroll) {
    return { positions: [0], complete: true, pageHeight: height, viewportHeight: viewport };
  }

  const requiredTiles = Math.ceil(height / viewport);
  if (requiredTiles <= tileLimit) {
    const positions = [];
    for (let position = 0; position < maximumScroll; position += viewport) positions.push(position);
    positions.push(maximumScroll);
    return {
      positions: [...new Set(positions.map((position) => Math.max(0, Math.round(position))))],
      complete: true,
      pageHeight: height,
      viewportHeight: viewport
    };
  }

  const positions = Array.from({ length: tileLimit }, (_, index) => (
    Math.round(index * maximumScroll / Math.max(1, tileLimit - 1))
  ));
  return {
    positions: [...new Set(positions)],
    complete: false,
    pageHeight: height,
    viewportHeight: viewport
  };
}

export function fullPageCanvasSize({
  viewportWidth,
  viewportHeight,
  pageHeight,
  imageWidth,
  imageHeight
} = {}, {
  maxWidth = 1_400,
  maxHeight = 16_000,
  maxPixels = 14_000_000
} = {}) {
  const sourceWidth = finiteDimension(imageWidth || viewportWidth);
  const sourceHeight = finiteDimension(imageHeight || viewportHeight);
  const cssViewportWidth = finiteDimension(viewportWidth, sourceWidth);
  const cssPageHeight = finiteDimension(pageHeight, finiteDimension(viewportHeight, sourceHeight));
  const deviceScale = sourceWidth / cssViewportWidth;
  let width = Math.min(sourceWidth, finiteDimension(maxWidth, 1_400));
  let height = Math.max(1, Math.round(cssPageHeight * deviceScale * width / sourceWidth));
  const heightLimit = finiteDimension(maxHeight, 16_000);
  const pixelLimit = finiteDimension(maxPixels, 14_000_000);
  const reduction = Math.min(1, heightLimit / height, Math.sqrt(pixelLimit / Math.max(1, width * height)));
  width = Math.max(1, Math.floor(width * reduction));
  height = Math.max(1, Math.floor(height * reduction));
  return { width, height, scale: width / sourceWidth };
}

function pageDimensions(documentValue = globalThis.document, windowValue = globalThis.window) {
  const root = documentValue?.documentElement;
  const body = documentValue?.body;
  const viewportWidth = finiteDimension(windowValue?.innerWidth || root?.clientWidth);
  const viewportHeight = finiteDimension(windowValue?.innerHeight || root?.clientHeight);
  const pageWidth = Math.max(
    viewportWidth,
    finiteDimension(root?.scrollWidth),
    finiteDimension(body?.scrollWidth)
  );
  const pageHeight = Math.max(
    viewportHeight,
    finiteDimension(root?.scrollHeight),
    finiteDimension(body?.scrollHeight),
    finiteDimension(root?.offsetHeight),
    finiteDimension(body?.offsetHeight)
  );
  return { viewportWidth, viewportHeight, pageWidth, pageHeight };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function nextPaint(windowValue) {
  return new Promise((resolve) => {
    const schedule = typeof windowValue?.requestAnimationFrame === 'function'
      ? (callback) => windowValue.requestAnimationFrame(callback)
      : (callback) => setTimeout(callback, 16);
    schedule(() => schedule(resolve));
  });
}

async function waitForVisibleImages(documentValue, windowValue) {
  const viewportHeight = finiteDimension(windowValue?.innerHeight);
  const pending = Array.from(documentValue?.images || [])
    .filter((image) => {
      if (image.complete) return false;
      const rect = image.getBoundingClientRect?.();
      return rect && rect.bottom >= 0 && rect.top <= viewportHeight;
    })
    .slice(0, 24)
    .map((image) => typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve());
  if (!pending.length) return;
  await Promise.race([Promise.allSettled(pending), wait(320)]);
}

function savedStyle(element, property) {
  return {
    element,
    property,
    value: element?.style?.getPropertyValue?.(property) || '',
    priority: element?.style?.getPropertyPriority?.(property) || ''
  };
}

function restoreStyle(entry) {
  if (!entry?.element?.style) return;
  if (entry.value) entry.element.style.setProperty(entry.property, entry.value, entry.priority);
  else entry.element.style.removeProperty(entry.property);
}

let activeSession = null;

function restoreSession(session, windowValue = globalThis.window) {
  if (!session) return;
  clearTimeout(session.restoreTimer);
  for (const entry of session.styles || []) restoreStyle(entry);
  try { windowValue?.scrollTo?.(session.scrollX, session.scrollY); } catch {}
  if (activeSession?.id === session.id) activeSession = null;
}

async function scrollAndSettle(position, {
  documentValue = globalThis.document,
  windowValue = globalThis.window,
  settleMs = DEEP_PAGE_SETTLE_MS
} = {}) {
  try { windowValue?.scrollTo?.(0, Math.max(0, Number(position) || 0)); } catch {}
  await nextPaint(windowValue);
  await wait(Math.max(0, Number(settleMs) || 0));
  await waitForVisibleImages(documentValue, windowValue);
  const dimensions = pageDimensions(documentValue, windowValue);
  return {
    ...dimensions,
    scrollX: Math.max(0, Math.round(Number(windowValue?.scrollX) || 0)),
    scrollY: Math.max(0, Math.round(Number(windowValue?.scrollY) || 0))
  };
}

export async function prepareDeepPageCapture({
  documentValue = globalThis.document,
  windowValue = globalThis.window,
  maxTiles = MAX_DEEP_PAGE_TILES
} = {}) {
  if (!documentValue?.documentElement || !windowValue) throw new Error('This document cannot be deeply captured.');
  if (activeSession) restoreSession(activeSession, windowValue);

  const root = documentValue.documentElement;
  const body = documentValue.body;
  const extensionHost = documentValue.getElementById?.('scholia-extension-root');
  const styles = [
    savedStyle(root, 'scroll-behavior'),
    savedStyle(root, 'scroll-snap-type'),
    savedStyle(root, 'overflow-anchor'),
    savedStyle(body, 'scroll-behavior'),
    savedStyle(body, 'scroll-snap-type'),
    savedStyle(extensionHost, 'display')
  ];
  root.style.setProperty('scroll-behavior', 'auto', 'important');
  root.style.setProperty('scroll-snap-type', 'none', 'important');
  root.style.setProperty('overflow-anchor', 'none', 'important');
  body?.style?.setProperty('scroll-behavior', 'auto', 'important');
  body?.style?.setProperty('scroll-snap-type', 'none', 'important');
  extensionHost?.style?.setProperty('display', 'none', 'important');

  const session = {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    scrollX: Number(windowValue.scrollX) || 0,
    scrollY: Number(windowValue.scrollY) || 0,
    styles
  };
  session.restoreTimer = setTimeout(() => restoreSession(session, windowValue), 45_000);
  activeSession = session;

  try {
    let dimensions = pageDimensions(documentValue, windowValue);
    let plan = deepPageScrollPlan(dimensions.pageHeight, dimensions.viewportHeight, maxTiles);
    const plannedHeight = plan.pageHeight;
    for (const position of plan.positions) {
      dimensions = await scrollAndSettle(position, { documentValue, windowValue, settleMs: 115 });
    }

    const expanded = pageDimensions(documentValue, windowValue);
    const expandedPlan = deepPageScrollPlan(expanded.pageHeight, expanded.viewportHeight, maxTiles);
    const previousMaximum = plan.positions.at(-1) || 0;
    if (expanded.pageHeight > plannedHeight + expanded.viewportHeight / 2) {
      for (const position of expandedPlan.positions.filter((value) => value > previousMaximum)) {
        await scrollAndSettle(position, { documentValue, windowValue, settleMs: 115 });
      }
    }

    dimensions = pageDimensions(documentValue, windowValue);
    plan = deepPageScrollPlan(dimensions.pageHeight, dimensions.viewportHeight, maxTiles);
    await scrollAndSettle(plan.positions[0] || 0, { documentValue, windowValue });
    return { sessionId: session.id, ...dimensions, positions: plan.positions, complete: plan.complete };
  } catch (error) {
    restoreSession(session, windowValue);
    throw error;
  }
}

export async function scrollDeepPageCapture(position, {
  sessionId = '',
  documentValue = globalThis.document,
  windowValue = globalThis.window
} = {}) {
  if (!activeSession || (sessionId && activeSession.id !== sessionId)) {
    throw new Error('The complete-page capture session expired.');
  }
  return scrollAndSettle(position, { documentValue, windowValue });
}

export function finishDeepPageCapture({
  sessionId = '',
  windowValue = globalThis.window
} = {}) {
  if (!activeSession) return { restored: false };
  if (sessionId && activeSession.id !== sessionId) return { restored: false };
  const session = activeSession;
  restoreSession(session, windowValue);
  return { restored: true, scrollX: session.scrollX, scrollY: session.scrollY };
}

export function embeddedFrameContext(frameSnapshots = [], {
  mainFrameId = 0,
  mainContext = '',
  maxChars = 240_000,
  maxFrames = 12
} = {}) {
  const mainComparable = compactText(mainContext);
  const seen = new Set();
  const sections = [];
  let used = 0;
  for (const entry of Array.from(frameSnapshots || [])) {
    if (!entry || Number(entry.frameId) === Number(mainFrameId)) continue;
    const result = entry.result || entry;
    const text = normalizedText(result?.text);
    if (text.length < 80) continue;
    const comparable = compactText(text);
    const signature = comparable.slice(0, 1_000);
    if (!signature || mainComparable.includes(signature) || seen.has(signature)) continue;
    seen.add(signature);
    const title = safeLabel(result?.title) || `Embedded frame ${Number(entry.frameId) || sections.length + 1}`;
    const url = safeLabel(result?.url);
    const header = `[Embedded frame: ${title}${url ? ` — ${url}` : ''}]\n`;
    const room = Math.max(0, Math.floor(maxChars) - used - header.length - 2);
    if (!room) break;
    const clipped = text.slice(0, room);
    sections.push(`${header}${clipped}`);
    used += header.length + clipped.length + 2;
    if (sections.length >= Math.max(1, Math.floor(maxFrames))) break;
  }
  return sections.join('\n\n');
}
