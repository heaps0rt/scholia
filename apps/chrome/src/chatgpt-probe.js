import {
  chatGptMemoryTextIsPending,
  chatGptMemoryTextIsUsable,
  chatGptPersonalizationUrl,
  findChatGptMemoryManageButton,
  readChatGptMemoryPanel,
  readChatGptWebPage
} from './chatgpt-web.js';

const GUIDE_ID = 'scholia-chatgpt-import-guide';
let memoryImportActive = false;
let importedMemoryText = '';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForValue(reader, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = reader();
    if (value) return value;
    await wait(100);
  }
  return null;
}

async function reopenPersonalizationSettings() {
  const destination = new URL(chatGptPersonalizationUrl(location.href));
  if (location.pathname !== destination.pathname || location.search !== destination.search) {
    throw new Error('ChatGPT opened the wrong settings route. Reload the Personalization tab and try again.');
  }
  if (location.hash === destination.hash) {
    const oldURL = location.href;
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }));
    await wait(80);
  }
  location.hash = destination.hash;
  await wait(120);
}

async function waitForStableMemoryPanel({ timeout = 45_000, stableFor = 1_500 } = {}) {
  const deadline = Date.now() + timeout;
  let previousText = '';
  let stableSince = 0;
  while (Date.now() < deadline) {
    const panel = readChatGptMemoryPanel(document, { allowBareMemory: true });
    const text = panel?.text || '';
    if (!panel || chatGptMemoryTextIsPending(text)) {
      previousText = '';
      stableSince = 0;
    } else if (text !== previousText) {
      previousText = text;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stableFor) {
      return panel;
    }
    await wait(150);
  }
  return null;
}

function currentState() {
  return readChatGptWebPage(document, window, {
    memoryImport: memoryImportActive,
    memoryText: importedMemoryText
  });
}

function appendUniqueLines(target, value) {
  for (const line of String(value || '').split('\n').map((entry) => entry.trim()).filter(Boolean)) {
    if (chatGptMemoryTextIsPending(line)) continue;
    if (!target.includes(line)) target.push(line);
  }
}

export async function collectMemoryPanelText(initialPanel) {
  const lines = [];
  const candidates = [initialPanel.root, ...initialPanel.root.querySelectorAll('*')]
    .filter((element) => element.scrollHeight > element.clientHeight + 8)
    .sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight));
  const scroller = candidates[0];
  if (!scroller) {
    appendUniqueLines(lines, initialPanel.text);
    return lines.join('\n').slice(0, 24_000);
  }

  const originalTop = scroller.scrollTop;
  const step = Math.max(240, Math.floor(scroller.clientHeight * 0.8));
  const deadline = Date.now() + 30_000;
  let nextTop = 0;
  let previousMaximum = -1;
  let previousText = '';
  let stableBottomPasses = 0;
  try {
    for (let passes = 0; passes < 80 && Date.now() < deadline; passes += 1) {
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = Math.min(nextTop, maximum);
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await wait(120);
      const settledPanel = await waitForStableMemoryPanel({ timeout: 3_000, stableFor: 300 });
      appendUniqueLines(lines, settledPanel?.text);

      const text = lines.join('\n');
      if (text.length >= 24_000) break;
      // Lazy lists can grow while being traversed, so the current bottom—not
      // the initial one—is the source of truth. Two unchanged bottom passes
      // distinguish a settled list from one waiting to append another page.
      const updatedMaximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const atBottom = scroller.scrollTop >= updatedMaximum - 2;
      if (atBottom) {
        stableBottomPasses = updatedMaximum === previousMaximum && text === previousText
          ? stableBottomPasses + 1
          : 0;
        if (stableBottomPasses >= 2) break;
        nextTop = updatedMaximum;
      } else {
        stableBottomPasses = 0;
        nextTop = Math.min(updatedMaximum, scroller.scrollTop + step);
      }
      previousMaximum = updatedMaximum;
      previousText = text;
    }
  } finally {
    scroller.scrollTop = originalTop;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  }
  return lines.join('\n').slice(0, 24_000);
}

async function prepareMemoryImport() {
  memoryImportActive = true;
  importedMemoryText = '';
  await reopenPersonalizationSettings();

  const ready = await waitForValue(() => {
    const manageButton = findChatGptMemoryManageButton(document);
    return manageButton ? { manageButton } : readChatGptMemoryPanel(document, { allowBareMemory: true });
  }, 15_000);
  if (!ready) throw new Error('ChatGPT Personalization opened, but Scholia could not find Memory summary or its Manage button.');

  if (ready.manageButton) {
    ready.manageButton.click();
    await wait(150);
  }
  const panel = await waitForStableMemoryPanel();
  if (!panel) throw new Error('ChatGPT did not finish generating its memory summary within 45 seconds. Try the import again after it finishes.');

  importedMemoryText = await collectMemoryPanelText(panel);
  if (!chatGptMemoryTextIsUsable(importedMemoryText)) {
    importedMemoryText = '';
    throw new Error('ChatGPT showed Personalization settings instead of the memory summary. Reopen Manage and try again.');
  }
  return currentState();
}

function showImportGuide() {
  document.getElementById(GUIDE_ID)?.remove();
  const host = document.createElement('div');
  host.id = GUIDE_ID;
  host.style.cssText = 'all:initial;position:fixed;right:20px;top:20px;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .guide { box-sizing:border-box;width:min(390px,calc(100vw - 40px));padding:16px 18px;border:1px solid #3b82f6;
      border-radius:14px;background:#111827;color:#f9fafb;box-shadow:0 18px 45px #0006;font:14px/1.45 system-ui,sans-serif; }
    strong { display:block;margin-bottom:5px;font-size:15px; } p { margin:0;color:#d1d5db; }
    button { margin-top:12px;padding:6px 11px;border:1px solid #64748b;border-radius:8px;background:#1f2937;color:#fff;
      font:600 13px system-ui,sans-serif;cursor:pointer; } button:hover { background:#334155; }
  `;
  const guide = document.createElement('div');
  guide.className = 'guide';
  guide.setAttribute('role', 'status');
  const title = document.createElement('strong');
  title.textContent = 'Scholia is connected';
  const copy = document.createElement('p');
  copy.textContent = 'Use “Get full memory from ChatGPT” in Scholia Settings to open Personalization and Manage automatically. For project context, select the project text you want, then return to Scholia.';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Got it';
  dismiss.addEventListener('click', () => host.remove());
  guide.append(title, copy, dismiss);
  shadow.append(style, guide);
  document.documentElement.append(host);
  setTimeout(() => host.remove(), 30_000);
}

// This deliberately small content script can also be injected into ChatGPT tabs
// that were already open when Scholia was installed or reloaded.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SCHOLIA_GET_CHATGPT_WEB_STATE') {
    sendResponse({ ok: true, value: currentState() });
    return false;
  }
  if (message?.type === 'SCHOLIA_PREPARE_CHATGPT_MEMORY_IMPORT') {
    prepareMemoryImport()
      .then((value) => sendResponse({ ok: true, value }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === 'SCHOLIA_SHOW_CHATGPT_IMPORT_GUIDE') {
    showImportGuide();
    sendResponse({ ok: true });
    return false;
  }
  return undefined;
});
