export const PANEL_REQUEST_KEY = 'scholia.panel-request.v1';
export const PANEL_NAVIGATION_KEY = 'scholia.panel-navigation.v1';
export const PAGE_SELECTION_KEY = 'scholia.page-selection.v1';
export const PDF_SOURCE_PREFIX = 'scholia.pdf-source.v1.';

export function pageSelectionStorageKey(tabId) {
  const id = Number(tabId);
  return Number.isInteger(id) && id > 0 ? `${PAGE_SELECTION_KEY}.${id}` : '';
}

const CHROME_PDF_VIEWER_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';
const PDF_URL_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'data:', 'blob:']);
const MANUAL_PDF_URL_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

function parsedUrl(value) {
  try {
    return new URL(String(value || ''));
  } catch {
    return null;
  }
}

function unwrappedViewerUrl(value) {
  const url = parsedUrl(value);
  if (!url || url.protocol !== 'chrome-extension:' || url.hostname !== CHROME_PDF_VIEWER_ID) return '';
  return url.searchParams.get('file') || '';
}

export function pdfViewerSourceId(value) {
  const url = parsedUrl(value);
  if (!url || url.protocol !== 'chrome-extension:' || !/\/pdf-viewer\.html$/.test(url.pathname)) return '';
  const sourceId = String(url.searchParams.get('source') || '');
  return /^[a-zA-Z0-9_-]{8,100}$/.test(sourceId) ? sourceId : '';
}

export function pdfViewerTabSourceId(tab = {}) {
  return [tab.pendingUrl, tab.url]
    .map(pdfViewerSourceId)
    .find(Boolean) || '';
}

export function pdfSourceStorageKey(sourceId) {
  const clean = String(sourceId || '');
  return /^[a-zA-Z0-9_-]{8,100}$/.test(clean) ? `${PDF_SOURCE_PREFIX}${clean}` : '';
}

export function manualPdfSourceUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 32_768) return '';
  const url = parsedUrl(raw);
  if (!url || !MANUAL_PDF_URL_PROTOCOLS.has(url.protocol) || url.username || url.password) return '';
  return url.href;
}

export function isPdfUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (unwrappedViewerUrl(raw)) return true;
  if (/^data:application\/pdf(?:[;,])/i.test(raw)) return true;
  const url = parsedUrl(raw);
  if (!url) return false;
  let pathname = url.pathname;
  try { pathname = decodeURIComponent(pathname); } catch {}
  return /\.pdf$/i.test(pathname);
}

function usablePdfUrl(value) {
  const unwrapped = unwrappedViewerUrl(value);
  const candidate = unwrapped || String(value || '').trim();
  const url = parsedUrl(candidate);
  return url && PDF_URL_PROTOCOLS.has(url.protocol) ? url.href : '';
}

export function isLikelyPdfTab(tab = {}, info = {}) {
  const candidates = [info.frameUrl, info.pageUrl, tab.url];
  return candidates.some((value) => isPdfUrl(value) || Boolean(pdfViewerSourceId(value)))
    || /(?:^|\s|[/\\])[^/\\]+\.pdf(?:\s|$)/i.test(String(tab.title || ''));
}

export function isCompletedPdfNavigation(changeInfo = {}, tab = {}) {
  return changeInfo.status === 'complete' && isLikelyPdfTab(tab);
}

export function pdfSourceUrl(tab = {}, info = {}) {
  const candidates = [info.frameUrl, info.pageUrl, tab.url];
  for (const candidate of candidates) {
    if (!isPdfUrl(candidate)) continue;
    const usable = usablePdfUrl(candidate);
    if (usable) return usable;
  }
  if (isLikelyPdfTab(tab, info)) {
    for (const candidate of candidates) {
      const usable = usablePdfUrl(candidate);
      if (usable) return usable;
    }
  }
  return '';
}

export function safeSourceUrl(value) {
  const url = parsedUrl(value);
  if (!url) return '';
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  }
  if (url.protocol === 'file:') return 'file://';
  return url.protocol;
}

export function contentFrameTarget(value = 0) {
  const frameId = Number(value);
  return {
    frameId: Number.isInteger(frameId) && frameId >= 0 ? frameId : 0
  };
}

export function preferredContentFrameId(requestedFrameId, registeredFrameId) {
  const requested = Number(requestedFrameId);
  if (Number.isInteger(requested) && requested > 0) return requested;
  const registered = Number(registeredFrameId);
  if (Number.isInteger(registered) && registered >= 0) return registered;
  return contentFrameTarget(requestedFrameId).frameId;
}

export function sendContentFrameMessage(tabs, tabId, message, frameId = 0) {
  return tabs.sendMessage(tabId, message, contentFrameTarget(frameId));
}

export function tabSource(tab = {}, info = {}) {
  const viewerSourceId = [info.frameUrl, info.pageUrl, tab.url]
    .map(pdfViewerSourceId)
    .find(Boolean) || '';
  const pdfUrl = pdfSourceUrl(tab, info);
  const sourceUrl = pdfUrl || String(info.pageUrl || tab.url || '');
  return {
    tabId: Number.isInteger(tab.id) ? tab.id : null,
    windowId: Number.isInteger(tab.windowId) ? tab.windowId : null,
    pageTitle: String(tab.title || '').trim(),
    url: viewerSourceId ? '' : safeSourceUrl(sourceUrl),
    pdfUrl,
    sourceKind: pdfUrl || viewerSourceId ? 'pdf' : 'page',
    viewerSourceId
  };
}
