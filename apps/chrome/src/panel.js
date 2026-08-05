import { packPageContext, packParentContext } from '../../../packages/core/src/context.js';
import { providerById } from '../../../packages/core/src/providers.js';
import { createUserTurn, normalizeSelectionAttachment, requestConversation } from './chat-turn.js';
import { extractPdfContext, fetchPdfBytes } from './pdf-context.js';
import { clipboardImageFile, normalizeImageFile } from './image-input.js';
import { currentSelectionCapture } from './page-capture.js';
import { renderMarkdown } from './render.js';
import { sendRuntimeMessage as message } from './runtime-message.js';
import { PAGE_SELECTION_KEY, PANEL_REQUEST_KEY } from './tab-context.js';

const MAX_LOCAL_PDF_BYTES = 100 * 1024 * 1024;
const elements = Object.fromEntries([
  'new-chat', 'settings', 'model-settings', 'home-view', 'chat-view', 'source-badge',
  'current-title', 'current-url', 'context-form', 'context-question', 'context-hint', 'site-scope-row', 'site-scope',
  'pdf-viewer-actions', 'open-pdf-viewer', 'pdf-viewer-state',
  'capture', 'paste-card', 'paste-selection', 'paste-question', 'paste-cancel',
  'paste-start', 'choose-image', 'model', 'site', 'site-toggle', 'explain', 'status', 'tab-changed',
  'chat-current-tab', 'chat-source-badge', 'context-state', 'chat-source-title',
  'chat-source-detail', 'chat-selection', 'chat-source-image', 'loading-card',
  'loading-title', 'loading-detail', 'pdf-fallback', 'pdf-fallback-message',
  'choose-pdf', 'use-visible', 'capture-editor', 'capture-stage', 'capture-image',
  'capture-selection', 'capture-cancel', 'capture-use', 'messages', 'composer-form',
  'composer-selection', 'composer-selection-label', 'composer-selection-text', 'composer-selection-clear',
  'attach-image', 'attach-region', 'composer', 'send', 'pdf-file', 'image-file',
  'response-explain', 'response-explain-preview', 'response-explain-question',
  'response-explain-send', 'response-explain-cancel',
  'response-window-backdrop', 'response-window-close', 'response-window-source',
  'response-window-messages', 'response-window-form', 'response-window-composer', 'response-window-send'
].map((id) => [id, document.getElementById(id)]));

let settings = null;
let activeSource = null;
let activeSite = null;
let capture = null;
let messages = [];
let streaming = false;
let requestId = '';
let port = null;
let renderFrame = null;
let operationController = null;
let pendingPdf = null;
let pendingPasteSource = null;
let captureDraft = null;
let captureRect = null;
let tabRefreshTimer = null;
let imageQuestionDraft = '';
let composerSelection = null;
let pendingResponseSelection = null;
let responseSelectionTimer = null;
let editingMessageIndex = -1;
let lastSyncedSelectionId = '';
let selectionPreparationId = 0;
let responseWindow = null;
const handledPanelRequests = new Set();
const pdfCache = new Map();

function showStatus(text, error = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle('error', error);
}

function shortSourceUrl(value) {
  if (!value) return '';
  if (value === 'file://') return 'Local file';
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
}

function countLabel(value) {
  const count = Number(value) || 0;
  return count >= 1_000_000
    ? `${(count / 1_000_000).toFixed(1)}m`
    : count >= 1_000 ? `${Math.round(count / 1_000)}k` : String(count);
}

function sourceTitle(source) {
  return source?.pageTitle || (source?.sourceKind === 'pdf' ? 'PDF document' : 'Current page');
}

function isPdfSource(source) {
  return source?.sourceKind === 'pdf' || Boolean(source?.pdfUrl);
}

function supportsSiteContext(source) {
  if (!source || isPdfSource(source)) return false;
  try { return ['http:', 'https:'].includes(new URL(source.url).protocol); } catch { return false; }
}

function renderContextHint() {
  const pdf = isPdfSource(activeSource);
  elements['context-hint'].textContent = elements['site-scope'].checked
    ? 'Scholia follows up to 48 same-site pages, indexes their rendered text locally, and sends only question-relevant excerpts.'
    : pdf
      ? 'The PDF is read page by page locally, then relevant pages are packed into the model context.'
      : 'Page text is indexed locally and packed into relevant excerpts before it is sent.';
}

async function refreshSettings() {
  settings = await message({ type: 'SCHOLIA_GET_PUBLIC_SETTINGS' });
  const provider = providerById(settings.provider);
  elements.model.textContent = `${provider.name} · ${settings.models[provider.id]}`;
}

function siteStatusText({ enabled, mode }) {
  if (mode === 'allowlist') return enabled ? 'This website is now whitelisted.' : 'This website was removed from the whitelist.';
  return enabled ? 'Scholia is enabled here.' : 'Scholia will stay hidden on this website.';
}

function renderSite() {
  if (!activeSite) return;
  elements.site.textContent = activeSite.site;
  elements['site-toggle'].hidden = false;
  elements['site-toggle'].textContent = activeSite.mode === 'allowlist'
    ? activeSite.enabled ? 'Remove from whitelist' : 'Whitelist this website'
    : activeSite.enabled ? 'Disable Scholia on this site' : 'Enable Scholia on this site';
}

async function refreshSite() {
  try {
    activeSite = await message({ type: 'SCHOLIA_GET_ACTIVE_SITE' });
    renderSite();
  } catch (error) {
    activeSite = null;
    elements.site.textContent = 'Not configurable';
    elements['site-toggle'].hidden = true;
    if (!activeSource) showStatus(error.message, true);
  }
}

function renderActiveSource() {
  if (!activeSource) return;
  const pdf = isPdfSource(activeSource);
  elements['source-badge'].textContent = pdf ? 'Current PDF' : 'Current page';
  elements['current-title'].textContent = sourceTitle(activeSource);
  elements['current-url'].textContent = shortSourceUrl(activeSource.url);
  elements['context-question'].placeholder = pdf
    ? 'Ask anything about this PDF…'
    : 'Ask anything about this page…';
  const siteContextAvailable = supportsSiteContext(activeSource);
  elements['site-scope-row'].hidden = !siteContextAvailable;
  elements['site-scope'].disabled = !siteContextAvailable;
  if (!siteContextAvailable) elements['site-scope'].checked = false;
  renderContextHint();
  elements['pdf-viewer-actions'].hidden = !pdf;
  elements['open-pdf-viewer'].hidden = !pdf || Boolean(activeSource.viewerSourceId);
  elements['pdf-viewer-state'].textContent = activeSource.viewerSourceId
    ? 'Selection Explain popup is active in this PDF.'
    : 'Open Scholia PDF view to select text and get the same Explain popup as a website.';
}

async function refreshActiveSource() {
  activeSource = await message({ type: 'SCHOLIA_GET_ACTIVE_SOURCE' });
  renderActiveSource();
  await refreshSite();
  if (capture?.tabId != null) {
    elements['tab-changed'].hidden = capture.tabId === activeSource.tabId && capture.url === activeSource.url;
  }
}

function showHome() {
  elements['home-view'].hidden = false;
  elements['chat-view'].hidden = true;
  elements['new-chat'].hidden = true;
}

function showChat() {
  elements['home-view'].hidden = true;
  elements['chat-view'].hidden = false;
  elements['new-chat'].hidden = false;
}

function showLoading(title, detail = '') {
  elements['loading-title'].textContent = title;
  elements['loading-detail'].textContent = detail;
  elements['loading-card'].hidden = false;
}

function hideLoading() {
  elements['loading-card'].hidden = true;
}

function setPreparationMode(preparing) {
  elements.messages.hidden = preparing;
  elements['composer-form'].hidden = preparing;
}

function cancelRequest() {
  try { port?.postMessage({ type: 'cancel', requestId }); } catch {}
  const assistant = messages.at(-1);
  if (assistant?.role === 'assistant' && assistant.streaming) assistant.streaming = false;
  streaming = false;
  port?.disconnect();
  port = null;
  renderMessages();
}

function resetConversation() {
  selectionPreparationId += 1;
  if (streaming) cancelRequest();
  closeResponseWindow({ restoreFocus: false });
  operationController?.abort();
  operationController = null;
  capture = null;
  messages = [];
  pendingPdf = null;
  pendingPasteSource = null;
  captureDraft = null;
  captureRect = null;
  elements['pdf-fallback'].hidden = true;
  elements['capture-editor'].hidden = true;
  elements['paste-card'].hidden = true;
  elements['tab-changed'].hidden = true;
  hideLoading();
  setPreparationMode(false);
  elements.composer.value = '';
  elements.composer.placeholder = 'Ask a follow-up…';
  imageQuestionDraft = '';
  composerSelection = null;
  pendingResponseSelection = null;
  editingMessageIndex = -1;
  hideResponseExplain();
  renderComposerSelection();
  renderMessages();
}

function startNewChat() {
  resetConversation();
  chrome.storage.session.remove(PAGE_SELECTION_KEY).catch(() => {});
  showHome();
  refreshActiveSource().catch((error) => showStatus(error.message, true));
  elements['context-question'].focus();
}

function renderCaptureSource(nextCapture) {
  const pdf = nextCapture.sourceKind === 'pdf';
  const site = nextCapture.sourceKind === 'site';
  const selected = Boolean(nextCapture.selection);
  const selectedImage = nextCapture.sourceKind === 'selected-image';
  const pastedImage = nextCapture.sourceKind === 'pasted-image';
  elements['chat-source-badge'].textContent = nextCapture.imageDataUrl
    ? selected ? 'Selection + image' : pastedImage ? 'Pasted image' : selectedImage ? 'Selected image' : 'Captured region'
    : site ? 'Site context'
      : pdf ? selected ? 'PDF selection' : 'PDF context'
      : selected ? 'Selected text' : 'Page context';
  elements['chat-source-title'].textContent = sourceTitle(nextCapture);
  elements['chat-source-detail'].textContent = nextCapture.contextNotice
    || shortSourceUrl(nextCapture.url)
    || 'Context ready';
  elements['context-state'].textContent = nextCapture.contextState || '';
  elements['chat-selection'].hidden = !selected;
  elements['chat-selection'].textContent = nextCapture.selection || '';
  elements['chat-source-image'].hidden = !nextCapture.imageDataUrl;
  if (nextCapture.imageDataUrl) elements['chat-source-image'].src = nextCapture.imageDataUrl;
  else elements['chat-source-image'].removeAttribute('src');
}

function composerPlaceholder() {
  if (composerSelection) return 'Ask about the selected text…';
  return capture?.kind === 'image' ? 'Ask about this image…' : 'Ask a follow-up…';
}

function renderComposerSelection() {
  const selected = normalizeSelectionAttachment(composerSelection);
  composerSelection = selected;
  elements['composer-selection'].hidden = !selected;
  elements['composer-selection-label'].textContent = selected?.label || '';
  elements['composer-selection-text'].textContent = selected?.text || '';
  elements.composer.placeholder = composerPlaceholder();
}

function setComposerSelection(attachment) {
  composerSelection = normalizeSelectionAttachment(attachment);
  renderComposerSelection();
}

function clearComposerSelection({ removeEmbeddedSource = false } = {}) {
  const selected = composerSelection;
  composerSelection = null;
  if (removeEmbeddedSource && selected?.embedded && capture?.selection === selected.text && !messages.length) {
    capture = { ...capture, selection: '' };
    renderCaptureSource(capture);
  }
  renderComposerSelection();
}

function hideResponseExplain() {
  clearTimeout(responseSelectionTimer);
  elements['response-explain'].hidden = true;
  pendingResponseSelection = null;
}

function selectionNodeElement(node) {
  return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
}

function assistantBubbleForNode(node) {
  return selectionNodeElement(node)?.closest?.('.message--assistant .bubble') || null;
}

function showResponseExplain(rect) {
  const selected = pendingResponseSelection;
  if (!selected) return;
  const popup = elements['response-explain'];
  elements['response-explain-preview'].textContent = selected.text.replace(/\s+/g, ' ').slice(0, 180);
  elements['response-explain-question'].value = '';
  popup.hidden = false;

  const padding = 8;
  const gap = 7;
  const width = popup.offsetWidth;
  const height = popup.offsetHeight;
  const anchor = rect || { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2, bottom: innerHeight / 2, width: 0 };
  const center = anchor.left + (anchor.width || 0) / 2;
  const left = Math.max(padding, Math.min(innerWidth - width - padding, center - width / 2));
  const above = anchor.top - height - gap;
  const top = above >= padding
    ? above
    : Math.max(padding, Math.min(innerHeight - height - padding, anchor.bottom + gap));
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function inspectResponseSelection() {
  if (streaming || editingMessageIndex >= 0 || elements['response-explain'].contains(document.activeElement)) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    hideResponseExplain();
    return;
  }
  const startBubble = assistantBubbleForNode(selection.anchorNode);
  const endBubble = assistantBubbleForNode(selection.focusNode);
  if (!startBubble || startBubble !== endBubble) {
    hideResponseExplain();
    return;
  }
  const row = startBubble.closest('.message');
  const messageIndex = Number(row?.dataset.messageIndex);
  const entry = Number.isInteger(messageIndex) ? messages[messageIndex] : null;
  const captured = currentSelectionCapture('', selection);
  const attachment = normalizeSelectionAttachment({
    origin: 'response',
    text: captured?.selection,
    label: 'Selected from a response',
    messageIndex
  });
  if (!entry || entry.role !== 'assistant' || entry.error || entry.streaming || !attachment) {
    hideResponseExplain();
    return;
  }
  pendingResponseSelection = attachment;
  showResponseExplain(captured?.rect);
}

function scheduleResponseSelectionInspection() {
  clearTimeout(responseSelectionTimer);
  responseSelectionTimer = setTimeout(inspectResponseSelection, 35);
}

function renderResponseWindowMessages() {
  const state = responseWindow;
  const list = elements['response-window-messages'];
  list.textContent = '';
  if (!state?.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-chat';
    empty.textContent = 'Preparing the explanation…';
    list.append(empty);
  }
  for (const entry of state?.messages || []) {
    const row = document.createElement('article');
    row.className = `response-window-message response-window-message--${entry.role}${entry.error ? ' response-window-message--error' : ''}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (entry.role === 'assistant' && !entry.error) {
      bubble.innerHTML = renderMarkdown(entry.content)
        + (entry.streaming ? '<span class="caret" aria-label="Writing"></span>' : '');
    } else {
      bubble.textContent = entry.content;
    }
    if (entry.meta) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = entry.meta;
      bubble.append(meta);
    }
    row.append(bubble);
    list.append(row);
  }
  list.scrollTop = list.scrollHeight;
  elements['response-window-send'].textContent = state?.streaming ? '■' : '↑';
  elements['response-window-send'].classList.toggle('is-stop', Boolean(state?.streaming));
  elements['response-window-send'].setAttribute('aria-label', state?.streaming ? 'Stop response' : 'Send');
}

function scheduleResponseWindowRender(state) {
  if (state !== responseWindow || state.renderFrame) return;
  state.renderFrame = requestAnimationFrame(() => {
    state.renderFrame = null;
    if (state === responseWindow) renderResponseWindowMessages();
  });
}

function cancelResponseWindowRequest({ render = true } = {}) {
  const state = responseWindow;
  if (!state) return;
  try { state.port?.postMessage({ type: 'cancel', requestId: state.requestId }); } catch {}
  const assistant = state.messages.at(-1);
  if (assistant?.role === 'assistant' && assistant.streaming) {
    assistant.streaming = false;
    if (!assistant.content) state.messages.pop();
  }
  state.streaming = false;
  state.port?.disconnect();
  state.port = null;
  if (render) renderResponseWindowMessages();
}

function closeResponseWindow({ restoreFocus = true } = {}) {
  const hadWindow = Boolean(responseWindow);
  if (responseWindow?.streaming) cancelResponseWindowRequest({ render: false });
  if (responseWindow?.renderFrame) cancelAnimationFrame(responseWindow.renderFrame);
  responseWindow = null;
  elements['response-window-backdrop'].hidden = true;
  elements['response-window-source'].textContent = '';
  elements['response-window-messages'].textContent = '';
  elements['response-window-composer'].value = '';
  if (hadWindow && restoreFocus) {
    requestAnimationFrame(() => {
      if (elements['response-window-backdrop'].hidden && !elements['chat-view'].hidden) elements.composer.focus();
    });
  }
}

function resizeResponseWindowComposer() {
  const textarea = elements['response-window-composer'];
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
}

function askResponseWindow(question) {
  const state = responseWindow;
  const cleanQuestion = String(question || '').trim();
  if (!state || !cleanQuestion || state.streaming) return;
  if (state.messages.at(-1)?.error) {
    state.messages.pop();
    if (state.messages.at(-1)?.role === 'user') state.messages.pop();
  }
  const user = createUserTurn(cleanQuestion);
  if (!user) return;
  state.messages.push(user);
  const assistant = { role: 'assistant', content: '', streaming: true, meta: '' };
  state.messages.push(assistant);
  state.streaming = true;
  renderResponseWindowMessages();

  const conversation = requestConversation(state.messages);
  conversation.pop();
  const chosen = selectedProviderModel();
  state.requestId = crypto.randomUUID();
  const currentRequestId = state.requestId;
  const chatPort = chrome.runtime.connect({ name: 'scholia-chat' });
  state.port = chatPort;

  chatPort.onMessage.addListener((event) => {
    if (state !== responseWindow || event.requestId !== currentRequestId) return;
    if (event.type === 'token') {
      assistant.content += event.token || '';
      scheduleResponseWindowRender(state);
    } else if (event.type === 'done') {
      assistant.streaming = false;
      assistant.meta = `${providerById(event.provider).name} · ${event.model}`;
      state.streaming = false;
      renderResponseWindowMessages();
      chatPort.disconnect();
      if (state.port === chatPort) state.port = null;
    } else if (event.type === 'error') {
      assistant.streaming = false;
      assistant.error = true;
      assistant.content = event.error || 'The provider request failed.';
      state.streaming = false;
      renderResponseWindowMessages();
      chatPort.disconnect();
      if (state.port === chatPort) state.port = null;
    } else if (event.type === 'cancelled') {
      assistant.streaming = false;
      const index = state.messages.indexOf(assistant);
      if (!assistant.content && index >= 0) state.messages.splice(index, 1);
      state.streaming = false;
      renderResponseWindowMessages();
    }
  });
  chatPort.onDisconnect.addListener(() => {
    if (state !== responseWindow || !state.streaming || state.requestId !== currentRequestId) return;
    assistant.streaming = false;
    assistant.error = true;
    const detail = chrome.runtime.lastError?.message;
    assistant.content ||= detail
      ? `The Scholia service worker disconnected: ${detail}`
      : 'The connection closed before the provider replied. Try again.';
    state.streaming = false;
    if (state.port === chatPort) state.port = null;
    renderResponseWindowMessages();
  });

  chatPort.postMessage({
    type: 'start',
    requestId: currentRequestId,
    payload: {
      ...chosen,
      messages: conversation,
      kind: /\$[^$]+\$/.test(state.attachment.text) ? 'latex' : 'text',
      selection: state.attachment.text,
      context: state.capture?.context || '',
      parentContext: state.parentContext,
      pageTitle: state.capture?.pageTitle || '',
      pageLanguage: state.capture?.pageLanguage || navigator.language,
      url: state.capture?.url || '',
      imageDataUrl: state.capture?.imageDataUrl || ''
    }
  });
}

function openResponseWindow(attachment, question) {
  const selected = normalizeSelectionAttachment(attachment);
  if (!selected || !capture) return;
  closeResponseWindow({ restoreFocus: false });
  const messageIndex = selected.messageIndex;
  const parentResponse = Number.isInteger(messageIndex) ? messages[messageIndex]?.content : '';
  responseWindow = {
    attachment: selected,
    capture: { ...capture },
    parentContext: packParentContext({
      messages: Number.isInteger(messageIndex)
        ? messages.filter((_entry, index) => index !== messageIndex)
        : messages,
      response: parentResponse || '',
      selection: selected.text
    }),
    messages: [],
    streaming: false,
    requestId: '',
    port: null,
    renderFrame: null
  };
  elements['response-window-source'].textContent = selected.text;
  elements['response-window-backdrop'].hidden = false;
  elements['response-window-composer'].value = '';
  renderResponseWindowMessages();
  requestAnimationFrame(() => elements['response-window-close'].focus());
  askResponseWindow(question || 'Explain this.');
}

function baseCapture(source, { selection = '', imageDataUrl = '', context = '', contextNotice = '', contextState = '' } = {}) {
  return {
    kind: imageDataUrl && !selection ? 'image' : /\$[^$]+\$/.test(selection) ? 'latex' : 'text',
    selection,
    context,
    pageTitle: source.pageTitle || '',
    pageLanguage: source.pageLanguage || navigator.language,
    url: source.url || '',
    imageDataUrl,
    sourceKind: source.sourceKind || 'page',
    pdfUrl: source.pdfUrl || '',
    viewerSourceId: source.viewerSourceId || '',
    tabId: source.tabId,
    contextNotice,
    contextState
  };
}

async function contextDescriptor(source, question, selection, siteWide = false) {
  const detected = await message({
    type: siteWide ? 'SCHOLIA_GET_ACTIVE_SITE_CONTEXT' : 'SCHOLIA_GET_ACTIVE_CONTEXT',
    expectedTabId: source?.tabId,
    question,
    selection
  });
  if (isPdfSource(source) && source.pdfUrl && detected.sourceKind !== 'pdf') {
    return { ...detected, ...source, pageLanguage: detected.pageLanguage || source.pageLanguage, sourceKind: 'pdf' };
  }
  return detected;
}

function updatePdfProgress(progress) {
  if (progress.phase === 'download') {
    const loaded = `${(progress.loaded / 1024 / 1024).toFixed(1)} MB`;
    const total = progress.total ? ` of ${(progress.total / 1024 / 1024).toFixed(1)} MB` : '';
    showLoading('Downloading PDF locally…', `${loaded}${total}`);
  } else {
    showLoading('Reading PDF text locally…', `Page ${progress.page} of ${progress.total}`);
  }
}

async function cachedPdfContext(url, signal) {
  if (pdfCache.has(url)) {
    showLoading('Using locally extracted PDF text…');
    return pdfCache.get(url);
  }
  const task = (async () => {
    const bytes = await fetchPdfBytes(url, { signal, onProgress: updatePdfProgress });
    return extractPdfContext(bytes, { signal, onProgress: updatePdfProgress });
  })();
  pdfCache.set(url, task);
  try {
    return await task;
  } catch (error) {
    pdfCache.delete(url);
    throw error;
  }
}

async function pdfCapture(source, { question, selection, imageDataUrl, bytes } = {}) {
  if (!settings?.includePageContext) {
    return baseCapture(source, {
      selection,
      imageDataUrl,
      contextNotice: 'Document context is disabled in provider settings.',
      contextState: 'Context off'
    });
  }

  const extracted = bytes
    ? await extractPdfContext(bytes, { signal: operationController.signal, onProgress: updatePdfProgress })
    : await cachedPdfContext(source.pdfUrl, operationController.signal);
  const title = extracted.title || source.pageTitle;
  let visual = imageDataUrl || '';
  let notice = '';
  if (!extracted.extractedCharacters && !visual && source.tabId != null) {
    const screenshot = await message({ type: 'SCHOLIA_CAPTURE_ACTIVE_VISIBLE', expectedTabId: source.tabId });
    visual = screenshot.imageDataUrl;
    notice = 'This PDF has no embedded text. Scholia is using the visible PDF page as image context.';
  }
  const packed = extracted.extractedCharacters
    ? packPageContext(extracted.context, { outline: extracted.outline, selection, question })
    : '';
  const state = extracted.extractedCharacters
    ? `${extracted.pageCount} pages · ${countLabel(extracted.extractedCharacters)} chars${extracted.truncated ? ' · capped' : ''}`
    : 'Scanned PDF · visual context';
  return baseCapture({ ...source, pageTitle: title, sourceKind: 'pdf' }, {
    selection,
    imageDataUrl: visual,
    context: packed,
    contextNotice: notice || shortSourceUrl(source.url),
    contextState: state
  });
}

function pageCapture(source, { selection, imageDataUrl } = {}) {
  const visual = imageDataUrl || source.imageDataUrl || '';
  const raw = Number(source.rawContextCharacters) || String(source.context || '').length;
  const packed = Number(source.packedContextCharacters) || String(source.context || '').length;
  let state = '';
  if (source.sourceKind === 'site') {
    const read = Number(source.sitePageCount) || 0;
    const discovered = Math.max(read, Number(source.siteDiscoveredPages) || 0);
    state = `${read}${discovered > read ? `/${discovered}` : ''} pages · ${countLabel(raw)} chars${source.siteTruncated ? ' · capped' : ''}`;
  } else if (source.sourceKind === 'visible-image') state = 'Visible tab · image context';
  else if (!source.context && settings?.includePageContext === false) state = 'Context off';
  else if (raw) state = raw > packed ? `${countLabel(raw)} chars · ${countLabel(packed)} packed` : `${countLabel(raw)} chars`;
  return baseCapture(source, {
    selection,
    imageDataUrl: visual,
    context: source.context || '',
    contextNotice: source.contextNotice || shortSourceUrl(source.url),
    contextState: state
  });
}

function showPdfFallback(error, request) {
  pendingPdf = request;
  hideLoading();
  setPreparationMode(true);
  elements['pdf-fallback-message'].textContent = error?.message || 'Chrome would not let Scholia read this PDF URL.';
  elements['pdf-fallback'].hidden = false;
}

function preparationError(error, source) {
  hideLoading();
  setPreparationMode(false);
  capture = baseCapture(source || {}, { contextNotice: error?.message || 'Context could not be loaded.' });
  renderCaptureSource(capture);
  messages = [{ role: 'assistant', content: error?.message || 'Scholia could not load this source.', error: true }];
  renderMessages();
}

function finalizePreparedChat(nextCapture, question) {
  capture = nextCapture;
  pendingPdf = null;
  elements['pdf-fallback'].hidden = true;
  elements['capture-editor'].hidden = true;
  hideLoading();
  setPreparationMode(false);
  renderCaptureSource(capture);
  ask(question || (capture.imageDataUrl ? 'Explain what is shown here.' : 'Explain this.'));
}

async function startContextChat({ source = activeSource, question, selection = '', imageDataUrl = '', siteWide = false } = {}) {
  if (!source) return;
  await (settings ? Promise.resolve() : refreshSettings());
  resetConversation();
  showChat();
  setPreparationMode(true);
  renderCaptureSource(baseCapture(source, { selection, imageDataUrl, contextNotice: 'Preparing source context…' }));
  showLoading(siteWide ? 'Reading the entire site locally…' : isPdfSource(source) ? 'Opening PDF…' : 'Reading page context…',
    siteWide ? 'Following same-site links and building a question-relevant index…' : '');
  operationController = new AbortController();

  let descriptor;
  try {
    descriptor = await contextDescriptor(source, question, selection, siteWide);
    if (isPdfSource(descriptor)) {
      try {
        const nextCapture = await pdfCapture(descriptor, { question, selection, imageDataUrl });
        finalizePreparedChat(nextCapture, question);
      } catch (error) {
        if (operationController.signal.aborted) return;
        if (imageDataUrl) {
          finalizePreparedChat(baseCapture(descriptor, {
            selection,
            imageDataUrl,
            contextNotice: `Full PDF text was unavailable; using the selected image region. ${error.message}`,
            contextState: 'Region context only'
          }), question);
        } else {
          showPdfFallback(error, { source: descriptor, question, selection, imageDataUrl });
        }
      }
      return;
    }
    finalizePreparedChat(pageCapture(descriptor, { selection, imageDataUrl }), question);
  } catch (error) {
    if (!operationController.signal.aborted) preparationError(error, descriptor || source);
  }
}

function finishSelectionDraft(nextCapture, attachment, preparationId, questionDraft = '') {
  if (preparationId !== selectionPreparationId) return;
  capture = nextCapture;
  pendingPdf = null;
  elements['pdf-fallback'].hidden = true;
  elements['capture-editor'].hidden = true;
  hideLoading();
  setPreparationMode(false);
  renderCaptureSource(capture);
  setComposerSelection({ ...attachment, embedded: true });
  elements.composer.value = String(questionDraft || '');
  resizeComposer();
  renderMessages();
}

async function prepareSyncedPageSelection(draft, attachment, questionDraft = '') {
  await (settings ? Promise.resolve() : refreshSettings());
  resetConversation();
  elements['context-question'].value = '';
  const preparationId = ++selectionPreparationId;
  showChat();
  setPreparationMode(true);
  renderCaptureSource(baseCapture(draft, {
    selection: attachment.text,
    contextNotice: 'Preparing the selected page context…'
  }));
  showLoading(isPdfSource(draft) ? 'Opening PDF…' : 'Reading page context…');
  const controller = new AbortController();
  operationController = controller;

  let descriptor;
  try {
    descriptor = await contextDescriptor(draft, '', attachment.text, false);
    if (preparationId !== selectionPreparationId || controller.signal.aborted) return;
    if (isPdfSource(descriptor)) {
      try {
        const nextCapture = await pdfCapture(descriptor, { question: '', selection: attachment.text });
        finishSelectionDraft(nextCapture, attachment, preparationId, questionDraft);
      } catch (error) {
        if (controller.signal.aborted) return;
        finishSelectionDraft(baseCapture(descriptor, {
          selection: attachment.text,
          contextNotice: `Using the selected PDF text without full document context. ${error.message}`,
          contextState: 'Selection context'
        }), attachment, preparationId, questionDraft);
      }
      return;
    }
    finishSelectionDraft(pageCapture(descriptor, { selection: attachment.text }), attachment, preparationId, questionDraft);
  } catch (error) {
    if (!controller.signal.aborted && preparationId === selectionPreparationId) {
      finishSelectionDraft(baseCapture(descriptor || draft, {
        selection: attachment.text,
        contextNotice: `Using the selected text without additional page context. ${error.message}`,
        contextState: 'Selection context'
      }), attachment, preparationId, questionDraft);
    }
  }
}

function sameSource(left, right) {
  if (!left || !right) return false;
  if (Number.isInteger(left.tabId) && Number.isInteger(right.tabId) && left.tabId !== right.tabId) return false;
  return String(left.url || left.pdfUrl || '') === String(right.url || right.pdfUrl || '');
}

async function consumeSyncedPageSelection(draft) {
  if (!draft?.id || draft.id === lastSyncedSelectionId || !draft.selection) return;
  if (Date.now() - Number(draft.createdAt || 0) > 10 * 60_000) return;
  if (!activeSource) await refreshActiveSource();
  if (Number.isInteger(activeSource?.tabId) && draft.tabId !== activeSource.tabId) return;

  lastSyncedSelectionId = draft.id;
  const attachment = normalizeSelectionAttachment({
    origin: 'page',
    text: draft.selection,
    label: draft.kind === 'latex' ? 'Selected mathematics from the page' : 'Selected from the page'
  });
  if (!attachment) return;

  if (!elements['chat-view'].hidden && messages.length && sameSource(capture, draft)) {
    setComposerSelection(attachment);
    return;
  }
  const questionDraft = elements['chat-view'].hidden
    ? elements['context-question'].value
    : elements.composer.value;
  await prepareSyncedPageSelection(draft, attachment, questionDraft);
}

async function refreshActiveSelection() {
  const draft = await message({ type: 'SCHOLIA_GET_ACTIVE_SELECTION' });
  if (draft) await consumeSyncedPageSelection(draft);
}

function selectedProviderModel() {
  const provider = settings?.provider || 'openai';
  return {
    provider,
    model: settings?.models?.[provider] || providerById(provider).defaultModel,
    reasoningEffort: settings?.reasoningEfforts?.[provider],
    fastMode: Boolean(settings?.fastMode)
  };
}

function ask(question, { attachment = composerSelection } = {}) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion || streaming || !capture) return;
  if (messages.at(-1)?.error) {
    messages.pop();
    if (messages.at(-1)?.role === 'user') messages.pop();
  }
  const user = createUserTurn(cleanQuestion, attachment);
  if (!user) return;
  if (user.attachment?.origin === 'page') chrome.storage.session.remove(PAGE_SELECTION_KEY).catch(() => {});
  messages.push(user);
  const assistant = { role: 'assistant', content: '', streaming: true, meta: '' };
  messages.push(assistant);
  streaming = true;
  clearComposerSelection();
  editingMessageIndex = -1;
  renderMessages();

  const conversation = requestConversation(messages);
  conversation.pop();
  const chosen = selectedProviderModel();
  requestId = crypto.randomUUID();
  const currentRequestId = requestId;
  const chatPort = chrome.runtime.connect({ name: 'scholia-chat' });
  port = chatPort;

  chatPort.onMessage.addListener((event) => {
    if (event.requestId !== currentRequestId) return;
    if (event.type === 'token') {
      assistant.content += event.token || '';
      scheduleRender();
    } else if (event.type === 'done') {
      assistant.streaming = false;
      assistant.meta = `${providerById(event.provider).name} · ${event.model}`;
      streaming = false;
      renderMessages();
      chatPort.disconnect();
      if (port === chatPort) port = null;
    } else if (event.type === 'error') {
      assistant.streaming = false;
      assistant.error = true;
      assistant.content = event.error || 'The provider request failed.';
      streaming = false;
      renderMessages();
      chatPort.disconnect();
      if (port === chatPort) port = null;
    } else if (event.type === 'cancelled') {
      assistant.streaming = false;
      const index = messages.indexOf(assistant);
      if (!assistant.content && index >= 0) messages.splice(index, 1);
      streaming = false;
      renderMessages();
    }
  });
  chatPort.onDisconnect.addListener(() => {
    if (!streaming || requestId !== currentRequestId) return;
    assistant.streaming = false;
    assistant.error = true;
    const detail = chrome.runtime.lastError?.message;
    assistant.content ||= detail
      ? `The Scholia service worker disconnected: ${detail}`
      : 'The connection closed before the provider replied. Try again.';
    streaming = false;
    if (port === chatPort) port = null;
    renderMessages();
  });

  chatPort.postMessage({
    type: 'start',
    requestId: currentRequestId,
    payload: {
      ...chosen,
      messages: conversation,
      kind: capture.kind,
      selection: capture.selection,
      context: capture.context,
      parentContext: '',
      pageTitle: capture.pageTitle,
      pageLanguage: capture.pageLanguage,
      url: capture.url,
      imageDataUrl: capture.imageDataUrl
    }
  });
}

function scheduleRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    renderMessages();
  });
}

function appendSelectionQuote(bubble, attachment) {
  const selected = normalizeSelectionAttachment(attachment);
  if (!selected) return;
  const quote = document.createElement('blockquote');
  quote.className = 'query-selection';
  quote.textContent = selected.text;
  quote.title = selected.label;
  bubble.append(quote);
}

function renderMessages() {
  elements.messages.textContent = '';
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-chat';
    empty.textContent = 'Your contextual conversation will appear here.';
    elements.messages.append(empty);
  }
  for (const [index, entry] of messages.entries()) {
    const row = document.createElement('article');
    row.className = `message message--${entry.role}${entry.error ? ' message--error' : ''}`;
    row.dataset.messageIndex = String(index);
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (entry.role === 'assistant' && !entry.error) {
      bubble.innerHTML = renderMarkdown(entry.content)
        + (entry.streaming ? '<span class="caret" aria-label="Writing"></span>' : '');
    } else if (entry.role === 'user' && editingMessageIndex === index) {
      row.classList.add('is-editing');
      appendSelectionQuote(bubble, entry.attachment);
      const editor = document.createElement('div');
      editor.className = 'query-editor';
      const textarea = document.createElement('textarea');
      textarea.value = entry.content;
      textarea.dataset.queryEditor = String(index);
      textarea.setAttribute('aria-label', 'Edit query');
      const actions = document.createElement('div');
      actions.className = 'query-editor-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'cancel';
      cancel.dataset.cancelQueryEdit = String(index);
      cancel.textContent = 'Cancel';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'save';
      save.dataset.saveQueryEdit = String(index);
      save.textContent = 'Save & regenerate';
      actions.append(cancel, save);
      editor.append(textarea, actions);
      bubble.append(editor);
    } else if (entry.role === 'user') {
      appendSelectionQuote(bubble, entry.attachment);
      const copy = document.createElement('div');
      copy.className = 'query-copy';
      copy.textContent = entry.content;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'query-edit';
      edit.dataset.editQuery = String(index);
      edit.disabled = streaming;
      edit.title = 'Edit this query and regenerate from here';
      edit.setAttribute('aria-label', 'Edit query');
      edit.textContent = 'Edit';
      bubble.append(copy, edit);
    } else {
      bubble.textContent = entry.content;
    }
    if (entry.meta) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = entry.meta;
      bubble.append(meta);
    }
    row.append(bubble);
    elements.messages.append(row);
  }
  if (editingMessageIndex >= 0) {
    requestAnimationFrame(() => {
      const textarea = elements.messages.querySelector(`[data-query-editor="${editingMessageIndex}"]`);
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea?.scrollIntoView({ block: 'nearest' });
    });
  } else {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }
  elements.send.textContent = streaming ? '■' : '↑';
  elements.send.classList.toggle('is-stop', streaming);
  elements.send.setAttribute('aria-label', streaming ? 'Stop response' : 'Send');
}

function beginQueryEdit(index) {
  if (streaming || messages[index]?.role !== 'user') return;
  hideResponseExplain();
  editingMessageIndex = index;
  renderMessages();
}

function cancelQueryEdit() {
  editingMessageIndex = -1;
  renderMessages();
}

function saveQueryEdit(index) {
  const entry = messages[index];
  const textarea = elements.messages.querySelector(`[data-query-editor="${index}"]`);
  const question = textarea?.value.trim() || '';
  if (!entry || entry.role !== 'user' || !question || streaming) {
    textarea?.focus();
    return;
  }
  const attachment = entry.attachment || null;
  messages.splice(index);
  editingMessageIndex = -1;
  ask(question, { attachment });
}

function explainResponseSelection() {
  const attachment = pendingResponseSelection;
  if (!attachment || streaming) return;
  const question = elements['response-explain-question'].value.trim() || 'Explain this.';
  hideResponseExplain();
  try { window.getSelection()?.removeAllRanges(); } catch {}
  openResponseWindow(attachment, question);
}

function resizeComposer() {
  elements.composer.style.height = 'auto';
  elements.composer.style.height = `${Math.min(elements.composer.scrollHeight, 120)}px`;
}

function showImageInputError(error) {
  const text = error?.message || 'Scholia could not read that image.';
  if (elements['chat-view'].hidden) {
    showStatus(text, true);
    return;
  }
  messages.push({ role: 'assistant', content: text, error: true });
  renderMessages();
}

function openImagePicker(question = '') {
  imageQuestionDraft = String(question || '');
  elements['image-file'].click();
}

async function useImageFile(file, { question = '', pasted = false } = {}) {
  if (!file) return;
  const imageDataUrl = await normalizeImageFile(file);
  const pageTitle = pasted ? 'Pasted image' : String(file.name || 'Selected image');
  const sourceKind = pasted ? 'pasted-image' : 'selected-image';
  resetConversation();
  showChat();
  capture = baseCapture({ pageTitle, pageLanguage: navigator.language, sourceKind }, {
    imageDataUrl,
    contextNotice: pasted ? 'Image pasted from the clipboard.' : 'Image selected from this device.',
    contextState: 'Image only'
  });
  renderCaptureSource(capture);
  renderMessages();
  elements.composer.value = String(question || '');
  elements.composer.placeholder = 'Ask about this image…';
  resizeComposer();
  elements.composer.focus();
}

function handleImagePaste(event) {
  const file = clipboardImageFile(event.clipboardData);
  if (!file) return;
  event.preventDefault();
  const target = event.currentTarget;
  const question = target === elements['paste-selection']
    ? elements['paste-question'].value
    : target?.value || '';
  useImageFile(file, { question, pasted: true }).catch(showImageInputError);
}

async function copyCode(event) {
  const button = event.target.closest?.('[data-copy-code]');
  if (!button) return;
  const code = button.closest('.scholia-code')?.querySelector('code')?.textContent || '';
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy'; }, 1000);
  } catch {}
}

function showPaste(source = activeSource) {
  resetConversation();
  pendingPasteSource = source;
  showHome();
  elements['paste-card'].hidden = false;
  elements['paste-selection'].value = source?.selection || '';
  elements['paste-question'].value = source?.question || '';
  elements['paste-selection'].focus();
}

async function explainPastedSelection() {
  const selection = elements['paste-selection'].value.trim();
  if (!selection) {
    showStatus('Paste the PDF selection first.', true);
    elements['paste-selection'].focus();
    return;
  }
  const question = elements['paste-question'].value.trim() || 'Explain this.';
  elements['paste-card'].hidden = true;
  await startContextChat({ source: pendingPasteSource || activeSource, question, selection });
}

async function useChosenPdf(file) {
  if (!pendingPdf || !file) return;
  if (file.size > MAX_LOCAL_PDF_BYTES) {
    elements['pdf-fallback-message'].textContent = 'This PDF is larger than Scholia\'s 100 MB local-processing limit.';
    return;
  }
  elements['pdf-fallback'].hidden = true;
  showLoading('Opening selected PDF…', file.name);
  operationController = new AbortController();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const source = { ...pendingPdf.source, pageTitle: file.name, sourceKind: 'pdf' };
    const nextCapture = await pdfCapture(source, { ...pendingPdf, bytes });
    finalizePreparedChat(nextCapture, pendingPdf.question);
  } catch (error) {
    if (!operationController.signal.aborted) showPdfFallback(error, pendingPdf);
  }
}

async function useVisiblePdfPage() {
  if (!pendingPdf) return;
  const request = pendingPdf;
  elements['pdf-fallback'].hidden = true;
  showLoading('Capturing the visible PDF page…');
  try {
    const screenshot = request.imageDataUrl
      ? { imageDataUrl: request.imageDataUrl, ...request.source }
      : await message({ type: 'SCHOLIA_CAPTURE_ACTIVE_VISIBLE', expectedTabId: request.source.tabId });
    finalizePreparedChat(baseCapture({ ...request.source, ...screenshot, sourceKind: 'pdf' }, {
      selection: request.selection,
      imageDataUrl: screenshot.imageDataUrl,
      contextNotice: 'Full PDF text was unavailable; using the visible PDF page as image context.',
      contextState: 'Visible page only'
    }), request.question);
  } catch (error) {
    preparationError(error, request.source);
  }
}

function pointInCapture(event) {
  const rect = elements['capture-image'].getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    displayWidth: rect.width,
    displayHeight: rect.height
  };
}

function paintCaptureRect(start, end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  Object.assign(elements['capture-selection'].style, {
    left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`
  });
  elements['capture-selection'].hidden = false;
  captureRect = { left, top, width, height, displayWidth: end.displayWidth, displayHeight: end.displayHeight };
  elements['capture-use'].textContent = width >= 12 && height >= 12 ? 'Use selected region' : 'Use full view';
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Chrome returned an unreadable screenshot.'));
    image.src = dataUrl;
  });
}

async function cropCapturedImage(dataUrl, rect) {
  const image = await loadImage(dataUrl);
  const validRect = rect && rect.width >= 12 && rect.height >= 12;
  const sourceX = validRect ? Math.round(rect.left * image.naturalWidth / rect.displayWidth) : 0;
  const sourceY = validRect ? Math.round(rect.top * image.naturalHeight / rect.displayHeight) : 0;
  const sourceWidth = validRect ? Math.round(rect.width * image.naturalWidth / rect.displayWidth) : image.naturalWidth;
  const sourceHeight = validRect ? Math.round(rect.height * image.naturalHeight / rect.displayHeight) : image.naturalHeight;
  const scale = Math.min(1, 1800 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image cropping is unavailable.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .88);
}

async function beginCapture(source = activeSource) {
  if (!source) return;
  resetConversation();
  showChat();
  setPreparationMode(true);
  renderCaptureSource(baseCapture(source, { contextNotice: 'Capturing the visible tab…' }));
  showLoading('Capturing the visible tab…');
  try {
    const screenshot = await message({ type: 'SCHOLIA_CAPTURE_ACTIVE_VISIBLE', expectedTabId: source.tabId });
    captureDraft = { source: { ...source, ...screenshot }, imageDataUrl: screenshot.imageDataUrl };
    captureRect = null;
    elements['capture-image'].src = screenshot.imageDataUrl;
    elements['capture-selection'].hidden = true;
    elements['capture-use'].textContent = 'Use full view';
    hideLoading();
    elements['capture-editor'].hidden = false;
  } catch (error) {
    preparationError(error, source);
  }
}

async function finishCapture() {
  if (!captureDraft) return;
  elements['capture-use'].disabled = true;
  showLoading('Preparing selected region…');
  try {
    const imageDataUrl = await cropCapturedImage(captureDraft.imageDataUrl, captureRect);
    const source = captureDraft.source;
    elements['capture-editor'].hidden = true;
    await startContextChat({
      source,
      question: 'Explain what is shown in this region.',
      imageDataUrl
    });
  } catch (error) {
    preparationError(error, captureDraft.source);
  } finally {
    elements['capture-use'].disabled = false;
  }
}

async function consumePanelRequest(request) {
  if (!request?.id || handledPanelRequests.has(request.id)) return;
  handledPanelRequests.add(request.id);
  await chrome.storage.session.remove(PANEL_REQUEST_KEY);
  if (Date.now() - Number(request.createdAt || 0) > 5 * 60_000) return;
  const source = {
    tabId: request.tabId,
    windowId: request.windowId,
    pageTitle: request.pageTitle,
    url: request.url,
    pdfUrl: request.pdfUrl,
    viewerSourceId: request.viewerSourceId || '',
    sourceKind: request.sourceKind || (request.pdfUrl ? 'pdf' : 'page')
  };
  if (request.mode === 'selection' && request.selection) {
    await startContextChat({ source, selection: request.selection, question: request.question || 'Explain this.' });
  } else if (request.mode === 'capture') {
    await beginCapture(source);
  } else {
    showPaste({ ...source, question: request.question || '' });
  }
}

elements['context-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  const question = elements['context-question'].value.trim();
  if (!question) return;
  elements['context-question'].value = '';
  const siteWide = elements['site-scope'].checked;
  startContextChat({ source: activeSource, question, siteWide }).catch((error) => preparationError(error, activeSource));
});
elements['site-scope'].addEventListener('change', renderContextHint);
elements['context-question'].addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    elements['context-form'].requestSubmit();
  }
});
elements.capture.addEventListener('click', () => beginCapture(activeSource));
elements['choose-image'].addEventListener('click', () => openImagePicker(elements['context-question'].value));
elements['open-pdf-viewer'].addEventListener('click', async () => {
  elements['open-pdf-viewer'].disabled = true;
  showStatus('Opening selectable Scholia PDF view…');
  try {
    await message({ type: 'SCHOLIA_OPEN_PDF_VIEWER' });
    showStatus('Select text in the PDF to open Explain.');
  } catch (error) {
    showStatus(error.message, true);
    elements['open-pdf-viewer'].disabled = false;
  }
});
elements['attach-region'].addEventListener('click', () => beginCapture(activeSource));
elements['attach-image'].addEventListener('click', () => openImagePicker(elements.composer.value));
elements['new-chat'].addEventListener('click', startNewChat);
elements['chat-current-tab'].addEventListener('click', startNewChat);
elements.settings.addEventListener('click', () => chrome.runtime.openOptionsPage());
elements['model-settings'].addEventListener('click', () => chrome.runtime.openOptionsPage());
elements.explain.addEventListener('click', async () => {
  showStatus('Opening the current selection…');
  try {
    const result = await message({ type: 'SCHOLIA_PANEL_COMMAND', command: 'SCHOLIA_EXPLAIN_CURRENT' });
    if (result.surface === 'page') showStatus('The explanation opened next to the selection.');
  } catch (error) { showStatus(error.message, true); }
});
elements['site-toggle'].addEventListener('click', async () => {
  if (!activeSite) return;
  elements['site-toggle'].disabled = true;
  try {
    activeSite = await message({ type: 'SCHOLIA_SET_ACTIVE_SITE_ENABLED', enabled: !activeSite.enabled });
    renderSite();
    showStatus(siteStatusText(activeSite));
  } catch (error) { showStatus(error.message, true); }
  finally { elements['site-toggle'].disabled = false; }
});
elements['paste-start'].addEventListener('click', explainPastedSelection);
elements['paste-cancel'].addEventListener('click', () => { elements['paste-card'].hidden = true; });
elements['choose-pdf'].addEventListener('click', () => elements['pdf-file'].click());
elements['pdf-file'].addEventListener('change', () => {
  const [file] = elements['pdf-file'].files || [];
  useChosenPdf(file).finally(() => { elements['pdf-file'].value = ''; });
});
elements['image-file'].addEventListener('change', () => {
  const [file] = elements['image-file'].files || [];
  const question = imageQuestionDraft;
  useImageFile(file, { question }).catch(showImageInputError).finally(() => {
    elements['image-file'].value = '';
    imageQuestionDraft = '';
  });
});
elements['use-visible'].addEventListener('click', useVisiblePdfPage);
elements['capture-cancel'].addEventListener('click', startNewChat);
elements['capture-use'].addEventListener('click', finishCapture);
elements.messages.addEventListener('click', (event) => {
  const edit = event.target.closest?.('[data-edit-query]');
  if (edit) { beginQueryEdit(Number(edit.dataset.editQuery)); return; }
  const save = event.target.closest?.('[data-save-query-edit]');
  if (save) { saveQueryEdit(Number(save.dataset.saveQueryEdit)); return; }
  const cancel = event.target.closest?.('[data-cancel-query-edit]');
  if (cancel) { cancelQueryEdit(); return; }
  copyCode(event);
});
elements.messages.addEventListener('keydown', (event) => {
  const editor = event.target.closest?.('[data-query-editor]');
  if (!editor) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelQueryEdit();
  } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    saveQueryEdit(Number(editor.dataset.queryEditor));
  }
});
elements.messages.addEventListener('pointerup', scheduleResponseSelectionInspection);
elements.messages.addEventListener('scroll', hideResponseExplain, { passive: true });
window.addEventListener('resize', hideResponseExplain);
document.addEventListener('selectionchange', scheduleResponseSelectionInspection);
document.addEventListener('pointerdown', (event) => {
  if (!elements['response-explain'].hidden && !elements['response-explain'].contains(event.target)) hideResponseExplain();
}, true);
elements['response-explain'].addEventListener('pointerdown', (event) => event.stopPropagation());
elements['response-explain-send'].addEventListener('click', explainResponseSelection);
elements['response-explain-cancel'].addEventListener('click', hideResponseExplain);
elements['response-explain-question'].addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    explainResponseSelection();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    hideResponseExplain();
  }
});
elements['response-window-close'].addEventListener('click', closeResponseWindow);
elements['response-window-backdrop'].addEventListener('pointerdown', (event) => {
  if (event.target === elements['response-window-backdrop']) closeResponseWindow();
});
elements['response-window-messages'].addEventListener('click', copyCode);
elements['response-window-composer'].addEventListener('input', resizeResponseWindowComposer);
elements['response-window-composer'].addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements['response-window-form'].requestSubmit();
  }
});
elements['response-window-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  if (responseWindow?.streaming) { cancelResponseWindowRequest(); return; }
  const question = elements['response-window-composer'].value.trim();
  if (!question) return;
  elements['response-window-composer'].value = '';
  resizeResponseWindowComposer();
  askResponseWindow(question);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements['response-window-backdrop'].hidden) {
    event.preventDefault();
    closeResponseWindow();
  }
});
elements['composer-selection-clear'].addEventListener('click', () => {
  clearComposerSelection({ removeEmbeddedSource: true });
  chrome.storage.session.remove(PAGE_SELECTION_KEY).catch(() => {});
});
elements.composer.addEventListener('input', resizeComposer);
[elements['context-question'], elements.composer, elements['paste-selection'], elements['paste-question']]
  .forEach((element) => element.addEventListener('paste', handleImagePaste));
elements.composer.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    elements['composer-form'].requestSubmit();
  }
});
elements['composer-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  if (streaming) { cancelRequest(); return; }
  const question = elements.composer.value.trim();
  if (!question) return;
  elements.composer.value = '';
  resizeComposer();
  ask(question);
});

{
  let start = null;
  elements['capture-stage'].addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    start = pointInCapture(event);
    elements['capture-stage'].setPointerCapture(event.pointerId);
    paintCaptureRect(start, start);
  });
  elements['capture-stage'].addEventListener('pointermove', (event) => {
    if (!start) return;
    paintCaptureRect(start, pointInCapture(event));
  });
  const end = (event) => {
    if (!start) return;
    paintCaptureRect(start, pointInCapture(event));
    start = null;
  };
  elements['capture-stage'].addEventListener('pointerup', end);
  elements['capture-stage'].addEventListener('pointercancel', () => { start = null; });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') refreshSettings().catch(() => {});
  if (area === 'session' && changes[PANEL_REQUEST_KEY]?.newValue) {
    consumePanelRequest(changes[PANEL_REQUEST_KEY].newValue).catch((error) => preparationError(error, activeSource));
  }
  if (area === 'session' && changes[PAGE_SELECTION_KEY]?.newValue) {
    consumeSyncedPageSelection(changes[PAGE_SELECTION_KEY].newValue).catch((error) => showStatus(error.message, true));
  }
});

function scheduleTabRefresh() {
  clearTimeout(tabRefreshTimer);
  tabRefreshTimer = setTimeout(() => {
    refreshActiveSource().then(refreshActiveSelection).catch(() => {});
  }, 120);
}
chrome.tabs.onActivated.addListener(scheduleTabRefresh);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeSource?.tabId && (changeInfo.status === 'complete' || changeInfo.url)) scheduleTabRefresh();
});

async function boot() {
  renderMessages();
  renderComposerSelection();
  try {
    await Promise.all([refreshSettings(), refreshActiveSource()]);
  } catch (error) {
    showStatus(error.message, true);
  }
  const pending = await chrome.storage.session.get(PANEL_REQUEST_KEY);
  if (pending[PANEL_REQUEST_KEY]) await consumePanelRequest(pending[PANEL_REQUEST_KEY]);
  else await refreshActiveSelection();
}

boot().catch((error) => showStatus(error.message, true));
