import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  mergeSettings,
  normalizeSiteKey,
  providerById,
  publicSettings,
  siteIsEnabled
} from '../../../packages/core/src/providers.js';
import { checkBridgeStatus, runCompletion } from './provider-runtime.js';
import {
  isLikelyPdfTab,
  PAGE_SELECTION_KEY,
  PANEL_REQUEST_KEY,
  pdfSourceStorageKey,
  pdfViewerSourceId,
  safeSourceUrl,
  tabSource
} from './tab-context.js';

const MENU_EXPLAIN = 'scholia-explain-selection';
const MENU_CAPTURE = 'scholia-capture-region';
const MAX_MENU_SELECTION_LENGTH = 12_000;
const PAGE_SELECTION_MAX_AGE = 10 * 60_000;
const PDF_SOURCE_MAX_AGE = 24 * 60 * 60_000;
const pdfRoutingTabs = new Set();
const nativePdfBypass = new Map();

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(stored[SETTINGS_KEY] || DEFAULT_SETTINGS);
}

async function saveSettings(settings) {
  const merged = mergeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

async function installMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU_EXPLAIN, title: 'Explain with Scholia', contexts: ['selection'] });
  chrome.contextMenus.create({ id: MENU_CAPTURE, title: 'Ask Scholia about a screen region', contexts: ['page', 'selection', 'image'] });
}

chrome.runtime.onInstalled.addListener(() => {
  installMenus().catch(console.error);
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active page is available.');
  return tab;
}

async function storedPdfSource(sourceId) {
  const key = pdfSourceStorageKey(sourceId);
  if (!key) return null;
  const stored = (await chrome.storage.session.get(key))[key];
  if (!stored || stored.id !== sourceId || Date.now() - Number(stored.createdAt || 0) > PDF_SOURCE_MAX_AGE) {
    await chrome.storage.session.remove(key).catch(() => {});
    return null;
  }
  return stored;
}

async function resolvedTabSource(tab = {}, info = {}) {
  const source = tabSource(tab, info);
  if (!source.viewerSourceId) return source;
  const stored = await storedPdfSource(source.viewerSourceId);
  if (!stored) return source;
  return {
    ...source,
    pageTitle: stored.pageTitle || source.pageTitle,
    url: stored.url || safeSourceUrl(stored.pdfUrl),
    pdfUrl: stored.pdfUrl || '',
    sourceKind: 'pdf'
  };
}

async function ensureTabIsEnabled(tab, info = {}) {
  const source = await resolvedTabSource(tab, info);
  const site = siteKey(source.pdfUrl || source.url || tab.url || '');
  if (!site) return source;
  const settings = await loadSettings();
  if (!siteIsEnabled(settings, site)) {
    throw new Error(settings.siteAccessMode === 'allowlist'
      ? 'This site is not whitelisted. Add it from the side panel first.'
      : 'Scholia is disabled on this site. Re-enable it from the side panel first.');
  }
  return source;
}

async function openPdfViewer(tab) {
  if (!tab?.id) throw new Error('No PDF tab is available.');
  const source = await ensureTabIsEnabled(tab);
  if (source.viewerSourceId) return source;
  if (source.sourceKind !== 'pdf' || !source.pdfUrl) throw new Error('The current tab is not a readable PDF.');

  const id = crypto.randomUUID();
  const key = pdfSourceStorageKey(id);
  const record = {
    id,
    createdAt: Date.now(),
    pdfUrl: source.pdfUrl,
    url: source.url || safeSourceUrl(source.pdfUrl),
    pageTitle: source.pageTitle || 'PDF document'
  };
  await chrome.storage.session.set({ [key]: record });
  const viewerUrl = chrome.runtime.getURL(`pdf-viewer.html?source=${encodeURIComponent(id)}`);
  pdfRoutingTabs.add(tab.id);
  try {
    await chrome.tabs.update(tab.id, { url: viewerUrl });
  } catch (error) {
    await chrome.storage.session.remove(key).catch(() => {});
    throw error;
  } finally {
    pdfRoutingTabs.delete(tab.id);
  }
  return { ...source, viewerSourceId: id, viewerUrl };
}

async function openNativePdf(tab) {
  const source = await resolvedTabSource(tab);
  if (!source.viewerSourceId || !source.pdfUrl) throw new Error('The original PDF address is no longer available.');
  nativePdfBypass.set(tab.id, { url: source.pdfUrl, expiresAt: Date.now() + 15_000 });
  await chrome.tabs.update(tab.id, { url: source.pdfUrl });
  return { url: source.url };
}

function bypassesPdfViewer(tabId) {
  const bypass = nativePdfBypass.get(tabId);
  if (!bypass) return false;
  if (bypass.expiresAt < Date.now()) {
    nativePdfBypass.delete(tabId);
    return false;
  }
  return true;
}

async function queuePanelRequest(tab, request, { info = {}, open = true, assumePdf = false } = {}) {
  const openRequest = open && tab.windowId != null
    ? chrome.sidePanel.open({ windowId: tab.windowId })
    : Promise.resolve();
  const [source] = await Promise.all([ensureTabIsEnabled(tab, info), openRequest]);
  if (assumePdf && !source.pdfUrl) {
    const candidate = String(info.frameUrl || info.pageUrl || tab.url || '');
    try {
      const parsed = new URL(candidate);
      if (['http:', 'https:', 'file:', 'data:', 'blob:'].includes(parsed.protocol)) {
        source.pdfUrl = parsed.href;
        source.sourceKind = 'pdf';
      }
    } catch {}
  }
  const value = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    mode: request.mode,
    question: String(request.question || ''),
    selection: String(request.selection || '').slice(0, MAX_MENU_SELECTION_LENGTH),
    ...source
  };
  await chrome.storage.session.set({ [PANEL_REQUEST_KEY]: value });
  return { surface: 'panel', mode: value.mode };
}

async function routeTabCommand(command, { openPanel = true } = {}) {
  const tab = await activeTab();
  const capture = command === 'SCHOLIA_START_CAPTURE';
  if (isLikelyPdfTab(tab)) {
    return queuePanelRequest(tab, { mode: capture ? 'capture' : 'paste' }, { open: openPanel });
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: command });
    return { surface: 'page', mode: capture ? 'capture' : 'selection' };
  } catch {
    return queuePanelRequest(tab, { mode: capture ? 'capture' : 'paste' }, {
      open: openPanel,
      assumePdf: true
    });
  }
}

function siteKey(rawUrl) {
  return normalizeSiteKey(rawUrl);
}

async function activeSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const source = await resolvedTabSource(tab || {});
  const site = siteKey(source.pdfUrl || source.url || tab?.url || '');
  if (!site) throw new Error('This page cannot be configured per site.');
  const settings = await loadSettings();
  return { site, enabled: siteIsEnabled(settings, site), mode: settings.siteAccessMode };
}

async function activeSource() {
  return resolvedTabSource(await activeTab());
}

async function storePageSelection(message, sender) {
  if (!sender.tab?.id || sender.tab.windowId == null) {
    throw new Error('Page selections must come from an open browser tab.');
  }
  const selection = String(message.selection || '').trim().slice(0, MAX_MENU_SELECTION_LENGTH);
  if (!selection) throw new Error('The page selection is empty.');
  const source = await resolvedTabSource(sender.tab, { pageUrl: sender.url });
  const value = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    selection,
    kind: message.kind === 'latex' ? 'latex' : 'text',
    ...source
  };
  await chrome.storage.session.set({ [PAGE_SELECTION_KEY]: value });
  return { id: value.id };
}

async function activePageSelection() {
  const tab = await activeTab();
  const stored = (await chrome.storage.session.get(PAGE_SELECTION_KEY))[PAGE_SELECTION_KEY];
  if (!stored) return null;
  if (Date.now() - Number(stored.createdAt || 0) > PAGE_SELECTION_MAX_AGE) {
    await chrome.storage.session.remove(PAGE_SELECTION_KEY);
    return null;
  }
  if (stored.tabId !== tab.id) return null;
  return stored;
}

async function setSiteEnabled(site, enabled) {
  if (!site) throw new Error('This page cannot be configured per site.');
  const settings = await loadSettings();
  if (settings.siteAccessMode === 'allowlist') {
    const allowed = new Set(settings.allowedSites);
    if (enabled) allowed.add(site);
    else allowed.delete(site);
    settings.allowedSites = [...allowed].sort();
  } else {
    const disabled = new Set(settings.disabledSites);
    if (enabled) disabled.delete(site);
    else disabled.add(site);
    settings.disabledSites = [...disabled].sort();
  }
  await saveSettings(settings);
  return { site, enabled: siteIsEnabled(settings, site), mode: settings.siteAccessMode };
}

chrome.commands.onCommand.addListener((command) => {
  const type = command === 'capture-region' ? 'SCHOLIA_START_CAPTURE' : 'SCHOLIA_EXPLAIN_CURRENT';
  routeTabCommand(type).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if ((!changeInfo.url && changeInfo.status !== 'complete') || pdfRoutingTabs.has(tabId)) return;
  const url = String(changeInfo.url || tab.url || '');
  if (pdfViewerSourceId(url) || bypassesPdfViewer(tabId) || !isLikelyPdfTab(tab)) return;
  openPdfViewer(tab).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pdfRoutingTabs.delete(tabId);
  nativePdfBypass.delete(tabId);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === MENU_EXPLAIN) {
    const selection = String(info.selectionText || '').trim();
    if (isLikelyPdfTab(tab, info)) {
      queuePanelRequest(tab, { mode: 'selection', selection }, { info }).catch(() => {});
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'SCHOLIA_EXPLAIN_TEXT', text: selection }).catch(() => {
      queuePanelRequest(tab, { mode: 'selection', selection }, { info, assumePdf: true }).catch(() => {});
    });
  } else if (info.menuItemId === MENU_CAPTURE) {
    if (isLikelyPdfTab(tab, info)) {
      queuePanelRequest(tab, { mode: 'capture' }, { info }).catch(() => {});
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'SCHOLIA_START_CAPTURE' }).catch(() => {
      queuePanelRequest(tab, { mode: 'capture' }, { info, assumePdf: true }).catch(() => {});
    });
  }
});

async function activeContext({ question = '', selection = '', expectedTabId = null } = {}) {
  const tab = await activeTab();
  if (Number.isInteger(expectedTabId) && tab.id !== expectedTabId) {
    throw new Error('The active tab changed. Return to the source and try again.');
  }
  const source = await ensureTabIsEnabled(tab);
  const pageLanguage = await chrome.tabs.detectLanguage(tab.id).catch(() => '');
  if (source.sourceKind === 'pdf') return { ...source, pageLanguage };

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'SCHOLIA_GET_PAGE_CONTEXT',
      question: String(question || ''),
      selection: String(selection || '')
    });
    if (!response?.ok) throw new Error(response?.error || 'The page did not return context.');
    return { ...source, ...response.value, sourceKind: 'page', pageLanguage: response.value?.pageLanguage || pageLanguage };
  } catch (error) {
    const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return {
      ...source,
      sourceKind: 'visible-image',
      pageLanguage,
      imageDataUrl,
      context: '',
      contextNotice: `Page text is protected from extensions; Scholia captured the visible tab instead. ${error?.message || ''}`.trim()
    };
  }
}

async function activeSiteContext({ question = '', selection = '', expectedTabId = null } = {}) {
  const tab = await activeTab();
  if (Number.isInteger(expectedTabId) && tab.id !== expectedTabId) {
    throw new Error('The active tab changed. Return to the site and try again.');
  }
  const source = await ensureTabIsEnabled(tab);
  if (source.sourceKind === 'pdf') throw new Error('Entire-site context is not available for PDF documents.');
  let url;
  try { url = new URL(source.url || tab.url || ''); } catch {}
  if (!url || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Entire-site context is available only on ordinary HTTP and HTTPS sites.');
  }
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: 'SCHOLIA_GET_SITE_CONTEXT',
    question: String(question || ''),
    selection: String(selection || '')
  });
  if (!response?.ok) throw new Error(response?.error || 'The site did not return context.');
  return { ...source, ...response.value, sourceKind: 'site' };
}

async function captureActiveVisible(expectedTabId = null) {
  const tab = await activeTab();
  if (Number.isInteger(expectedTabId) && tab.id !== expectedTabId) {
    throw new Error('The active tab changed before capture. Return to the source and try again.');
  }
  const source = await ensureTabIsEnabled(tab);
  const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const pageLanguage = await chrome.tabs.detectLanguage(tab.id).catch(() => '');
  return { ...source, pageLanguage, imageDataUrl };
}

function respondAsync(sendResponse, task) {
  task.then((value) => sendResponse({ ok: true, value })).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
}

function isExtensionPage(sender) {
  return sender.url?.startsWith(chrome.runtime.getURL('')) === true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return undefined;

  if (message.type === 'SCHOLIA_GET_PUBLIC_SETTINGS') {
    respondAsync(sendResponse, loadSettings().then(publicSettings));
    return true;
  }

  if (message.type === 'SCHOLIA_GET_SETTINGS') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'Settings are available only to extension pages.' });
      return false;
    }
    respondAsync(sendResponse, loadSettings());
    return true;
  }

  if (message.type === 'SCHOLIA_SAVE_SETTINGS') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'Settings can be changed only from an extension page.' });
      return false;
    }
    respondAsync(sendResponse, saveSettings(message.settings));
    return true;
  }

  if (message.type === 'SCHOLIA_SAVE_MODEL') {
    respondAsync(sendResponse, loadSettings().then((settings) => {
      const provider = String(message.provider || '');
      const model = String(message.model || '').trim();
      if (providerById(provider).id !== provider || !model || model.length > 200) {
        throw new Error('Choose a valid provider and model.');
      }
      settings.provider = provider;
      settings.models[provider] = model;
      if (message.reasoningEffort != null) settings.reasoningEfforts[provider] = String(message.reasoningEffort);
      if (message.fastMode != null) settings.fastMode = Boolean(message.fastMode);
      return saveSettings(settings).then(publicSettings);
    }));
    return true;
  }

  if (message.type === 'SCHOLIA_BRIDGE_STATUS') {
    respondAsync(sendResponse, loadSettings().then((settings) => checkBridgeStatus(String(message.provider || settings.provider), settings, {
      includeUsage: Boolean(message.includeUsage)
    })));
    return true;
  }

  if (message.type === 'SCHOLIA_SET_SITE_ENABLED') {
    respondAsync(sendResponse, resolvedTabSource(sender.tab || { url: sender.url }, { pageUrl: sender.url }).then((source) => {
      const site = siteKey(source.pdfUrl || source.url || sender.url || '');
      return setSiteEnabled(site, Boolean(message.enabled));
    }));
    return true;
  }

  if (message.type === 'SCHOLIA_PAGE_SELECTION_CHANGED') {
    respondAsync(sendResponse, storePageSelection(message, sender));
    return true;
  }

  if (message.type === 'SCHOLIA_GET_ACTIVE_SOURCE') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'Active-source details are available only to extension pages.' });
      return false;
    }
    respondAsync(sendResponse, activeSource());
    return true;
  }

  if (message.type === 'SCHOLIA_GET_ACTIVE_SELECTION') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'Active selections are available only to extension pages.' });
      return false;
    }
    respondAsync(sendResponse, activePageSelection());
    return true;
  }

  if (message.type === 'SCHOLIA_GET_ACTIVE_SITE') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'Active-site details are available only to extension pages.' });
      return false;
    }
    respondAsync(sendResponse, activeSite());
    return true;
  }

  if (message.type === 'SCHOLIA_SET_ACTIVE_SITE_ENABLED') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'Site settings can be changed only from an extension page.' });
      return false;
    }
    respondAsync(sendResponse, activeSite().then(({ site }) => setSiteEnabled(site, Boolean(message.enabled))));
    return true;
  }

  if (message.type === 'SCHOLIA_CAPTURE_VISIBLE') {
    if (sender.tab?.windowId == null || sender.tab?.id == null) {
      sendResponse({ ok: false, error: 'Screen capture must be started from a web page.' });
      return false;
    }
    respondAsync(sendResponse, chrome.tabs.get(sender.tab.id).then((tab) => {
      if (!tab.active || tab.windowId !== sender.tab.windowId) throw new Error('The page changed before capture. Try again.');
      return chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
    }));
    return true;
  }

  if (message.type === 'SCHOLIA_GET_ACTIVE_CONTEXT') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'Page context is available only to extension pages.' });
      return false;
    }
    respondAsync(sendResponse, activeContext(message));
    return true;
  }

  if (message.type === 'SCHOLIA_GET_ACTIVE_SITE_CONTEXT') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'Site context is available only to extension pages.' });
      return false;
    }
    respondAsync(sendResponse, activeSiteContext(message));
    return true;
  }

  if (message.type === 'SCHOLIA_CAPTURE_ACTIVE_VISIBLE') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'Tab capture is available only to extension pages.' });
      return false;
    }
    respondAsync(sendResponse, captureActiveVisible(message.expectedTabId));
    return true;
  }

  if (message.type === 'SCHOLIA_GET_PDF_VIEWER_SOURCE') {
    const requestedId = String(message.sourceId || '');
    if (!isExtensionPage(sender) || !requestedId || pdfViewerSourceId(sender.url) !== requestedId) {
      sendResponse({ ok: false, error: 'The PDF source request is not valid for this viewer.' });
      return false;
    }
    respondAsync(sendResponse, storedPdfSource(requestedId).then((source) => {
      if (!source) throw new Error('This PDF viewer session expired. Reopen the original PDF.');
      return source;
    }));
    return true;
  }

  if (message.type === 'SCHOLIA_OPEN_PDF_VIEWER') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'The PDF viewer can be opened only from Scholia.' });
      return false;
    }
    respondAsync(sendResponse, activeTab().then(openPdfViewer));
    return true;
  }

  if (message.type === 'SCHOLIA_OPEN_NATIVE_PDF') {
    if (!isExtensionPage(sender) || !sender.tab?.id) {
      sendResponse({ ok: false, error: 'The original PDF can be opened only from its Scholia viewer.' });
      return false;
    }
    respondAsync(sendResponse, openNativePdf(sender.tab));
    return true;
  }

  if (message.type === 'SCHOLIA_OPEN_SIDE_PANEL') {
    if (!isExtensionPage(sender) || sender.tab?.windowId == null) {
      sendResponse({ ok: false, error: 'The side panel can be opened only from a Scholia tab.' });
      return false;
    }
    respondAsync(sendResponse, chrome.sidePanel.open({ windowId: sender.tab.windowId }));
    return true;
  }

  if (message.type === 'SCHOLIA_OPEN_OPTIONS') {
    respondAsync(sendResponse, chrome.runtime.openOptionsPage());
    return true;
  }

  if (message.type === 'SCHOLIA_PANEL_COMMAND') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'Page commands are available only to extension pages.' });
      return false;
    }
    if (!['SCHOLIA_EXPLAIN_CURRENT', 'SCHOLIA_START_CAPTURE'].includes(message.command)) {
      sendResponse({ ok: false, error: 'Unknown page command.' });
      return false;
    }
    respondAsync(sendResponse, routeTabCommand(message.command, { openPanel: false }));
    return true;
  }

  if (message.type === 'SCHOLIA_TEST_PROVIDER') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'Provider tests are available only from settings.' });
      return false;
    }
    respondAsync(sendResponse, loadSettings().then(async (settings) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const result = await runCompletion({
          provider: message.provider,
          model: message.model,
          messages: [{ role: 'user', content: 'Reply with OK only.' }],
          pageLanguage: 'en',
          kind: 'text'
        }, settings, () => {}, controller.signal);
        return { text: result.text.trim().slice(0, 120), provider: result.provider, model: result.model };
      } finally {
        clearTimeout(timeout);
      }
    }));
    return true;
  }

  return undefined;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'scholia-chat') return;
  let active = null;

  port.onMessage.addListener(async (message) => {
    if (message?.type === 'cancel') {
      if (!message.requestId || message.requestId === active?.id) active?.controller.abort();
      return;
    }
    if (message?.type !== 'start') return;

    active?.controller.abort();
    if (active?.heartbeat) clearInterval(active.heartbeat);

    const request = {
      id: String(message.requestId || crypto.randomUUID()),
      controller: new AbortController(),
      heartbeat: null
    };
    active = request;
    request.heartbeat = setInterval(() => {
      try {
        port.postMessage({ type: 'heartbeat', requestId: request.id });
      } catch {
        clearInterval(request.heartbeat);
      }
    }, 20_000);

    try {
      const settings = await loadSettings();
      const result = await runCompletion(message.payload || {}, settings, (token) => {
        if (active !== request) return;
        try { port.postMessage({ type: 'token', requestId: request.id, token }); } catch {}
      }, request.controller.signal);
      if (active === request) port.postMessage({ type: 'done', requestId: request.id, ...result });
    } catch (error) {
      if (active !== request) return;
      if (error?.name === 'AbortError') {
        try { port.postMessage({ type: 'cancelled', requestId: request.id }); } catch {}
      } else {
        try { port.postMessage({ type: 'error', requestId: request.id, error: error?.message || String(error) }); } catch {}
      }
    } finally {
      clearInterval(request.heartbeat);
      if (active === request) active = null;
    }
  });

  port.onDisconnect.addListener(() => {
    if (active?.heartbeat) clearInterval(active.heartbeat);
    active?.controller.abort();
    active = null;
  });
});
