import {
  fetchPdfBytes,
  formatPdfContext,
  MAX_EXTRACTED_CHARACTERS,
  MAX_EXTRACTED_PAGES,
  MAX_PDF_BYTES,
  textContentToString
} from './pdf-context.js';
import { sendRuntimeMessage as message } from './runtime-message.js';
import { pdfViewerSourceId } from './tab-context.js';

const BASE_SCALE = 1.2;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;
const elements = Object.fromEntries([
  'document-title', 'document-status', 'page-count', 'zoom-out', 'zoom-label',
  'zoom-in', 'choose-file', 'open-native', 'open-chat', 'viewer', 'loading',
  'loading-detail', 'error', 'error-message', 'error-choose-file', 'pages', 'pdf-file'
].map((id) => [id, document.getElementById(id)]));

let source = null;
let pdfjs = null;
let pdf = null;
let loadingTask = null;
let zoom = 1;
let pageStates = [];
let renderObserver = null;
let scrollFrame = null;
let loadGeneration = 0;
let metadataPromise;
let resolveMetadata;

function resetMetadata() {
  metadataPromise = new Promise((resolve) => { resolveMetadata = resolve; });
  metadataPromise.catch(() => {});
}

globalThis.__scholiaGetPageMetadata = () => metadataPromise;
resetMetadata();

function setStatus(value) {
  elements['document-status'].textContent = value;
}

function showLoading(value) {
  elements['loading-detail'].textContent = value;
  elements.loading.hidden = false;
  elements.error.hidden = true;
}

function showError(error) {
  elements.loading.hidden = true;
  elements.error.hidden = false;
  elements['error-message'].textContent = error?.message || String(error);
  setStatus('Choose the PDF file to continue');
}

function updateDownloadProgress(progress) {
  if (progress.phase !== 'download') return;
  const loaded = `${(progress.loaded / 1024 / 1024).toFixed(1)} MB`;
  const total = progress.total ? ` of ${(progress.total / 1024 / 1024).toFixed(1)} MB` : '';
  showLoading(`Downloading ${loaded}${total} locally…`);
}

function sourceId() {
  return pdfViewerSourceId(location.href);
}

function installScholia() {
  return new Promise((resolve, reject) => {
    if (document.getElementById('scholia-extension-root')) { resolve(); return; }
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content.js');
    script.onload = resolve;
    script.onerror = () => reject(new Error('Scholia selection controls could not be loaded.'));
    document.head.append(script);
  });
}

async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(chrome.runtime.getURL('vendor/pdfjs/pdf.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');
  return pdfjs;
}

function pdfOptions(bytes) {
  const assetRoot = chrome.runtime.getURL('vendor/pdfjs/');
  return {
    data: bytes,
    cMapUrl: `${assetRoot}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetRoot}standard_fonts/`,
    isEvalSupported: false,
    useSystemFonts: true
  };
}

function pageViewport(state) {
  return state.page.getViewport({ scale: BASE_SCALE * zoom });
}

function sizePage(state) {
  const viewport = pageViewport(state);
  state.surface.style.width = `${Math.ceil(viewport.width)}px`;
  state.surface.style.height = `${Math.ceil(viewport.height)}px`;
  state.surface.style.setProperty('--scale-factor', String(viewport.scale));
}

function createPageState(page, pageNumber, total) {
  const shell = document.createElement('section');
  shell.className = 'pdf-page';
  shell.dataset.pageNumber = String(pageNumber);
  shell.setAttribute('aria-label', `PDF page ${pageNumber} of ${total}`);
  const surface = document.createElement('div');
  surface.className = 'pdf-page__surface is-loading';
  const label = document.createElement('span');
  label.className = 'page-label';
  label.textContent = `Page ${pageNumber} of ${total}`;
  shell.append(surface, label);
  const state = {
    page,
    pageNumber,
    shell,
    surface,
    renderTask: null,
    textLayer: null,
    rendering: null,
    renderedZoom: 0,
    version: 0
  };
  sizePage(state);
  elements.pages.append(shell);
  renderObserver.observe(shell);
  return state;
}

function cancelled(error) {
  return error?.name === 'RenderingCancelledException' || /cancel/i.test(String(error?.message || ''));
}

async function renderPage(state) {
  if (!pdf || state.renderedZoom === zoom) return;
  if (state.rendering) return state.rendering;
  const version = ++state.version;
  state.rendering = (async () => {
    const page = await pdf.getPage(state.pageNumber);
    if (version !== state.version) return;
    state.page = page;
    const viewport = pageViewport(state);
    const pixelRatio = window.devicePixelRatio || 1;
    state.surface.replaceChildren();
    state.surface.classList.add('is-loading');
    sizePage(state);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error(`Page ${state.pageNumber} could not create a canvas.`);

    const textLayerElement = document.createElement('div');
    textLayerElement.className = 'textLayer';
    state.surface.append(canvas, textLayerElement);
    state.renderTask = page.render({
      canvasContext: context,
      transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      viewport
    });
    state.textLayer = new pdfjs.TextLayer({
      textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
      container: textLayerElement,
      viewport
    });
    await Promise.all([state.renderTask.promise, state.textLayer.render()]);
    if (version !== state.version) return;
    const end = document.createElement('div');
    end.className = 'endOfContent';
    textLayerElement.append(end);
    state.renderedZoom = zoom;
    state.surface.classList.remove('is-loading');
  })().catch((error) => {
    if (!cancelled(error)) {
      state.surface.classList.remove('is-loading');
      state.surface.title = error?.message || 'This page could not be rendered.';
    }
  }).finally(() => {
    if (version === state.version) state.rendering = null;
  });
  return state.rendering;
}

function resetRenderedPages() {
  for (const state of pageStates) {
    state.version += 1;
    try { state.renderTask?.cancel(); } catch {}
    try { state.textLayer?.cancel(); } catch {}
    state.renderTask = null;
    state.textLayer = null;
    state.rendering = null;
    state.renderedZoom = 0;
    state.surface.replaceChildren();
    state.surface.classList.add('is-loading');
    sizePage(state);
    renderObserver.unobserve(state.shell);
    renderObserver.observe(state.shell);
  }
}

function updateZoom(next) {
  const rounded = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next)) * 100) / 100;
  if (rounded === zoom) return;
  zoom = rounded;
  elements['zoom-label'].textContent = `${Math.round(zoom * 100)}%`;
  elements['zoom-out'].disabled = zoom <= MIN_ZOOM;
  elements['zoom-in'].disabled = zoom >= MAX_ZOOM;
  resetRenderedPages();
  updateCurrentPage();
}

function updateCurrentPage() {
  scrollFrame = null;
  if (!pageStates.length) return;
  const toolbarBottom = document.querySelector('.toolbar').getBoundingClientRect().bottom;
  let best = pageStates[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const state of pageStates) {
    const rect = state.shell.getBoundingClientRect();
    if (rect.bottom < toolbarBottom || rect.top > innerHeight) continue;
    const distance = Math.abs(rect.top - toolbarBottom - 18);
    if (distance < bestDistance) { best = state; bestDistance = distance; }
  }
  elements['page-count'].textContent = `${best.pageNumber} / ${pdf?.numPages || pageStates.length}`;
}

function scheduleCurrentPage() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(updateCurrentPage);
}

function initializeObservers() {
  renderObserver?.disconnect();
  renderObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const state = pageStates.find((candidate) => candidate.shell === entry.target);
      if (entry.isIntersecting && state) renderPage(state);
    }
  }, { rootMargin: '900px 0px' });
}

async function documentTitle(documentProxy) {
  try {
    const info = (await documentProxy.getMetadata()).info || {};
    return String(info.Title || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  } catch {
    return '';
  }
}

async function openBytes(bytes, fallbackTitle = '') {
  const generation = ++loadGeneration;
  resetMetadata();
  await loadPdfJs();
  await loadingTask?.destroy().catch(() => {});
  await pdf?.destroy().catch(() => {});
  loadingTask = pdfjs.getDocument(pdfOptions(bytes));
  showLoading('Parsing the PDF locally…');
  const nextPdf = await loadingTask.promise;
  if (generation !== loadGeneration) { await nextPdf.destroy(); return; }
  pdf = nextPdf;
  elements.pages.replaceChildren();
  pageStates = [];
  initializeObservers();

  const metadataTitle = await documentTitle(pdf);
  const title = metadataTitle || fallbackTitle || source?.pageTitle || 'PDF document';
  document.title = `${title} — Scholia PDF`;
  elements['document-title'].textContent = title;
  elements['page-count'].textContent = `1 / ${pdf.numPages}`;
  showLoading(`Reading page 1 of ${pdf.numPages} for document context…`);

  const pages = [];
  let extractedCharacters = 0;
  const pagesToPrepare = Math.min(pdf.numPages, MAX_EXTRACTED_PAGES);
  for (let pageNumber = 1; pageNumber <= pagesToPrepare; pageNumber += 1) {
    if (generation !== loadGeneration) return;
    const page = await pdf.getPage(pageNumber);
    const state = createPageState(page, pageNumber, pdf.numPages);
    pageStates.push(state);
    if (pageNumber === 1) {
      renderPage(state);
      elements.loading.hidden = true;
    }

    if (extractedCharacters < MAX_EXTRACTED_CHARACTERS) {
      const text = textContentToString((await page.getTextContent()).items);
      const room = MAX_EXTRACTED_CHARACTERS - extractedCharacters;
      pages.push(text.slice(0, Math.max(0, room)));
      extractedCharacters += Math.min(text.length, Math.max(0, room));
    }
    setStatus(`Indexing context · page ${pageNumber} of ${pdf.numPages}`);
  }

  const formatted = formatPdfContext(pages, pdf.numPages);
  resolveMetadata({
    ...formatted,
    pageTitle: title,
    url: source?.url || '',
    pageLanguage: navigator.language,
    imageDataUrl: ''
  });
  elements.loading.hidden = true;
  setStatus(`${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'} · selectable text · context ready`);
  updateCurrentPage();
}

async function chooseFile(file) {
  if (!file) return;
  if (file.size > MAX_PDF_BYTES) throw new Error('This PDF is larger than Scholia\'s 100 MB local-processing limit.');
  showLoading(`Opening ${file.name} locally…`);
  await openBytes(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.pdf$/i, ''));
}

async function boot() {
  const id = sourceId();
  if (!id) { showError(new Error('This Scholia PDF link is incomplete. Reopen the original PDF.')); return; }
  try {
    source = await message({ type: 'SCHOLIA_GET_PDF_VIEWER_SOURCE', sourceId: id });
    document.documentElement.dataset.scholiaSourceUrl = source.url || '';
    elements['document-title'].textContent = source.pageTitle || 'PDF document';
    installScholia().catch((error) => setStatus(error.message));
    const bytes = await fetchPdfBytes(source.pdfUrl, { onProgress: updateDownloadProgress });
    await openBytes(bytes, source.pageTitle);
  } catch (error) {
    showError(error);
  }
}

elements['zoom-out'].addEventListener('click', () => updateZoom(zoom - ZOOM_STEP));
elements['zoom-in'].addEventListener('click', () => updateZoom(zoom + ZOOM_STEP));
elements['open-chat'].addEventListener('click', () => {
  message({ type: 'SCHOLIA_OPEN_SIDE_PANEL' }).catch((error) => setStatus(error.message));
});
elements['open-native'].addEventListener('click', () => {
  message({ type: 'SCHOLIA_OPEN_NATIVE_PDF' }).catch((error) => setStatus(error.message));
});
const openFileChooser = () => elements['pdf-file'].click();
elements['choose-file'].addEventListener('click', openFileChooser);
elements['error-choose-file'].addEventListener('click', openFileChooser);
elements['pdf-file'].addEventListener('change', () => {
  const [file] = elements['pdf-file'].files || [];
  chooseFile(file).catch(showError).finally(() => { elements['pdf-file'].value = ''; });
});
window.addEventListener('scroll', scheduleCurrentPage, { passive: true });
window.addEventListener('resize', scheduleCurrentPage, { passive: true });

boot();
