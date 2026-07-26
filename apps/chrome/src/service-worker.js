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

const MENU_EXPLAIN = 'scholia-explain-selection';
const MENU_CAPTURE = 'scholia-capture-region';

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

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active page is available.');
  return chrome.tabs.sendMessage(tab.id, message);
}

function siteKey(rawUrl) {
  return normalizeSiteKey(rawUrl);
}

async function activeSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const site = siteKey(tab?.url || '');
  if (!site) throw new Error('This page cannot be configured per site.');
  const settings = await loadSettings();
  return { site, enabled: siteIsEnabled(settings, site), mode: settings.siteAccessMode };
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
  sendToActiveTab({ type }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === MENU_EXPLAIN) {
    chrome.tabs.sendMessage(tab.id, { type: 'SCHOLIA_EXPLAIN_TEXT', text: info.selectionText || '' }).catch(() => {});
  } else if (info.menuItemId === MENU_CAPTURE) {
    chrome.tabs.sendMessage(tab.id, { type: 'SCHOLIA_START_CAPTURE' }).catch(() => {});
  }
});

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
    const site = siteKey(sender.tab?.url || sender.url || '');
    respondAsync(sendResponse, setSiteEnabled(site, Boolean(message.enabled)));
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
    respondAsync(sendResponse, sendToActiveTab({ type: message.command }));
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
