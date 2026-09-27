import {
  chatGptMemoryLooksLikePersonalizationPage,
  isChatGptWebUrl,
  safeChatGptWebUrl
} from '../../../packages/core/src/chatgpt-context.js';

const MAX_CAPTURE_CHARACTERS = 24_000;
const MEMORY_MANAGER_TITLES = [/^manage memories$/i, /^saved memories$/i, /^memories$/i, /^memory summary$/i];
const MEMORY_MANAGE_LABEL = /^(?:manage|manage(?: saved)? memor(?:y|ies)?|view memor(?:y|ies)|administrer(?: minner)?|gérer(?: les souvenirs)?|erinnerungen verwalten)$/i;

export async function requestChatGptWebStateWithInjection({ request, inject }) {
  try {
    const response = await request();
    if (response?.ok && response.value?.supported) return response;
  } catch {}
  await inject();
  return request();
}

function cleanCaptureText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, MAX_CAPTURE_CHARACTERS);
}

export function chatGptMemoryTextIsPending(value) {
  const text = cleanCaptureText(value);
  if (!text) return true;
  const lines = text.split('\n');
  return lines.some((line) => /^(?:generating|loading|genererer|laster)(?:\b|\s|[.…])/i.test(line)
    || /\b(?:memory|memory summary) is being generated\b/i.test(line)
    || /\b(?:minne|minnesammendrag)(?:et)? (?:blir|genereres)\b/i.test(line)
    || /^(?:please wait|vennligst vent)(?:\b|[.…])/i.test(line));
}

// The Personalization page itself contains a Memory card. It is not a memory
// snapshot, even though its visible text includes the words "memory summary".
// Keep this textual guard independent of ChatGPT's volatile class names so all
// manual and background imports reject the same false-positive deterministically.
export function chatGptMemoryTextIsPersonalizationPage(value) {
  return chatGptMemoryLooksLikePersonalizationPage(cleanCaptureText(value));
}

export function chatGptMemoryTextIsUsable(value) {
  const text = cleanCaptureText(value);
  return Boolean(text)
    && !chatGptMemoryTextIsPending(text)
    && !chatGptMemoryTextIsPersonalizationPage(text);
}

export function chatGptMemoryManageControlMatches({
  label = '',
  testID = '',
  contextText = ''
} = {}) {
  const cleanLabel = cleanCaptureText(label);
  const cleanTestID = cleanCaptureText(testID);
  if (/(?:manage|saved|view)[-_ ]*memor|memor(?:y|ies)?[-_ ]*(?:manage|saved|view)/i.test(cleanTestID)) {
    return true;
  }
  if (!MEMORY_MANAGE_LABEL.test(cleanLabel)) return false;
  if (!/^manage$/i.test(cleanLabel)) return true;
  return /\b(?:enable memory|memory summary|saved memor(?:y|ies)|view an overview of what chatgpt has learned|administrer minner|g[ée]rer les souvenirs|erinnerungen verwalten)\b/i
    .test(cleanCaptureText(contextText));
}

function cleanProjectName(value) {
  return cleanCaptureText(value)
    .replace(/\s*[—–|-]\s*ChatGPT\s*$/i, '')
    .replace(/^ChatGPT\s*[—–|-]\s*/i, '')
    .slice(0, 180);
}

export function chatGptPersonalizationUrl(value = 'https://chatgpt.com/') {
  const source = isChatGptWebUrl(value) ? value : 'https://chatgpt.com/';
  const url = new URL(source);
  url.username = '';
  url.password = '';
  url.pathname = '/';
  url.search = '';
  url.hash = 'settings/Personalization';
  return url.href;
}

export function chatGptProjectIdentity({ url = '', title = '', heading = '' } = {}) {
  if (!isChatGptWebUrl(url)) return { projectName: '', projectUrl: '' };
  const parsed = new URL(url);
  const projectGizmo = /(?:^|\/)g\/(g-p-[^/]+)/i.exec(parsed.pathname);
  const namedProject = /(?:^|\/)projects?\/[^/]+/i.test(parsed.pathname);
  if (!projectGizmo && !namedProject) return { projectName: '', projectUrl: '' };
  return {
    projectName: cleanProjectName(heading || title),
    projectUrl: projectGizmo
      ? `${parsed.origin}/g/${projectGizmo[1]}/project`
      : safeChatGptWebUrl(parsed.href)
  };
}

export function summarizeChatGptWebPage({
  url = '',
  title = '',
  heading = '',
  selectedText = '',
  dialogText = '',
  memoryText = '',
  hasComposer = false,
  hasAccountMenu = false,
  hasLoginControl = false
} = {}) {
  if (!isChatGptWebUrl(url)) return { supported: false, loggedIn: false };
  const project = chatGptProjectIdentity({ url, title, heading });
  const candidateMemory = cleanCaptureText(memoryText);
  const memory = chatGptMemoryTextIsUsable(candidateMemory) ? candidateMemory : '';
  const selection = cleanCaptureText(selectedText);
  const dialog = cleanCaptureText(dialogText);
  const captureText = memory || selection || dialog;
  const captureKind = memory ? 'memory' : selection ? 'selection' : dialog ? 'dialog' : '';
  const loggedIn = !hasLoginControl && Boolean(hasComposer || hasAccountMenu || project.projectUrl);
  return {
    supported: true,
    loggedIn,
    pageTitle: cleanProjectName(title) || 'ChatGPT',
    url: safeChatGptWebUrl(url),
    ...project,
    memoryText: memory,
    captureText,
    captureKind,
    capturedCharacters: captureText.length
  };
}

function visibleElement(element) {
  if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
  const view = element.ownerDocument?.defaultView || globalThis;
  for (let current = element; current?.nodeType === 1; current = current.parentElement) {
    if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return false;
    const style = view.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
  }
  return true;
}

function firstVisibleElement(document, selectors) {
  for (const selector of selectors) {
    const element = [...document.querySelectorAll(selector)].find(visibleElement);
    if (element) return element;
  }
  return null;
}

function firstVisibleText(document, selectors) {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (!visibleElement(element)) continue;
      const text = cleanCaptureText(element.innerText || element.textContent);
      if (text) return text;
    }
  }
  return '';
}

function exactVisibleTextElements(document, patterns, selectors = 'h1,h2,h3,h4,[role="heading"]') {
  const elements = [...document.querySelectorAll(selectors)].filter(visibleElement);
  const matches = [];
  for (const pattern of patterns) {
    for (const element of elements) {
      if (pattern.test(cleanCaptureText(element.innerText || element.textContent))) matches.push(element);
    }
  }
  return matches;
}

function settingsNavigationScore(value) {
  const text = cleanCaptureText(value).toLowerCase();
  return ['general', 'notifications', 'personalization', 'data controls', 'security and login']
    .filter((label) => text.includes(label)).length;
}

function memoryContentRoot(marker) {
  const dialog = marker.closest?.('[role="dialog"], [data-radix-dialog-content], [data-testid*="modal" i]');
  let candidate = marker.parentElement || marker;
  while (candidate?.parentElement && candidate !== dialog) {
    const parent = candidate.parentElement;
    const parentText = parent.innerText || parent.textContent || '';
    if (settingsNavigationScore(parentText) >= 3) break;
    candidate = parent;
    if (candidate === dialog) break;
  }
  return candidate || dialog || marker;
}

function textLinesFromElement(element) {
  const lines = cleanCaptureText(element?.innerText || element?.textContent).split('\n');
  for (const field of element?.querySelectorAll?.('textarea, input:not([type]), input[type="text"]') || []) {
    const value = cleanCaptureText(field.value);
    if (value && !lines.includes(value)) lines.push(value);
  }
  const ignored = /^(?:manage|manage memories|saved memories|memory summary|memory|search memories|search|delete all(?: memories)?|close|done|add memory)$/i;
  return cleanCaptureText(lines.filter((line) => line && !ignored.test(line)).join('\n'));
}

export function findChatGptMemoryManageButton(document = globalThis.document) {
  for (const button of document.querySelectorAll('button, [role="button"], a[href]')) {
    if (!visibleElement(button)) continue;
    const label = [
      button.innerText,
      button.textContent,
      button.getAttribute?.('aria-label'),
      button.getAttribute?.('title')
    ].map(cleanCaptureText).find(Boolean) || '';
    const testID = cleanCaptureText(button.getAttribute?.('data-testid'));
    // Explicit, semantically named controls and labels such as “Manage
    // memories” are self-identifying. A bare “Manage” must be proven by its
    // nearby card instead of a distant ancestor containing the entire settings
    // page, otherwise an unrelated subscription control can be selected.
    if (chatGptMemoryManageControlMatches({ label, testID })) return button;
    let ancestor = button.parentElement;
    let contextText = '';
    for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
      contextText = cleanCaptureText(ancestor.innerText || ancestor.textContent);
      if (settingsNavigationScore(contextText) >= 3
          || chatGptMemoryTextIsPersonalizationPage(contextText)) break;
      if (chatGptMemoryManageControlMatches({ label, testID, contextText })) return button;
    }
  }
  return null;
}

export function readChatGptMemoryPanel(document = globalThis.document, { allowBareMemory = false } = {}) {
  const patterns = allowBareMemory ? [...MEMORY_MANAGER_TITLES, /^memory$/i] : MEMORY_MANAGER_TITLES;
  const manageButton = findChatGptMemoryManageButton(document);
  for (const marker of exactVisibleTextElements(document, patterns)) {
    const title = cleanCaptureText(marker.innerText || marker.textContent);
    const dialog = marker.closest?.(
      '[role="dialog"], [data-radix-dialog-content], [data-testid*="modal" i]'
    );
    // “Memory” is also the heading of the settings card. It is meaningful as
    // a manager title only after ChatGPT renders it in a modal/dialog surface.
    if (/^memory$/i.test(title) && !dialog) continue;
    const root = memoryContentRoot(marker);
    if (/^(?:memory summary|memory)$/i.test(title) && manageButton && root.contains?.(manageButton)) continue;
    const text = textLinesFromElement(root);
    if (chatGptMemoryTextIsUsable(text)) return { root, title, text };
  }
  return null;
}

function projectHeading(document, url) {
  const parsed = isChatGptWebUrl(url) ? new URL(url) : null;
  const gizmo = parsed && /(?:^|\/)g\/(g-p-[^/]+)/i.exec(parsed.pathname)?.[1];
  if (gizmo) {
    const escaped = globalThis.CSS?.escape ? CSS.escape(gizmo) : gizmo.replace(/[^a-z0-9_-]/gi, '');
    const linkText = firstVisibleText(document, [`a[href*="/g/${escaped}" i]`]);
    if (linkText) return linkText;
  }
  return firstVisibleText(document, [
    '[data-testid="project-name"]',
    '[data-testid*="project" i] [role="heading"]',
    'main h1',
    'header h1'
  ]);
}

export function readChatGptWebPage(
  document = globalThis.document,
  window = globalThis.window,
  { memoryImport = false, memoryText = '' } = {}
) {
  const url = window?.location?.href || '';
  if (!isChatGptWebUrl(url)) return summarizeChatGptWebPage({ url });
  const selectedText = cleanCaptureText(window.getSelection?.()?.toString());
  const memoryPanel = memoryText ? null : readChatGptMemoryPanel(document, { allowBareMemory: memoryImport });
  const visibleMemoryText = memoryPanel && chatGptMemoryTextIsUsable(memoryPanel.text) ? memoryPanel.text : '';
  const dialogText = memoryPanel || memoryText ? '' : firstVisibleText(document, [
    '[role="dialog"][aria-modal="true"]',
    '[role="dialog"]',
    '[data-radix-dialog-content]',
    '[data-testid*="modal" i]'
  ]);
  const hasComposer = Boolean(firstVisibleElement(document, [
    '#prompt-textarea',
    'textarea[name="prompt-textarea"]',
    'textarea[data-testid*="prompt" i]',
    '[data-testid*="composer" i] [contenteditable="true"]',
    'main form [contenteditable="true"]',
    'main form textarea',
    'div.ProseMirror[contenteditable="true"]'
  ]));
  const hasAccountMenu = Boolean(firstVisibleElement(document, [
    '[data-testid="profile-button"]',
    '[data-testid="accounts-profile-button"]',
    '[data-testid*="profile" i] button',
    '[data-testid*="account" i] button',
    'button[aria-label*="profile" i]',
    'button[aria-label*="account" i]',
    'nav a[href^="/c/"]',
    'aside a[href^="/c/"]'
  ]));
  const hasLoginControl = Boolean(firstVisibleElement(document, [
    'a[href*="/auth/login"]',
    'a[href*="/login"]',
    'button[data-testid*="login" i]',
    '[data-testid*="login" i] button'
  ]));
  return summarizeChatGptWebPage({
    url,
    title: document.title,
    heading: projectHeading(document, url),
    selectedText,
    dialogText,
    memoryText: memoryText || visibleMemoryText,
    hasComposer,
    hasAccountMenu,
    hasLoginControl
  });
}
