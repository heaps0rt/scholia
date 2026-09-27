export const MAX_CHATGPT_MEMORY_CONTEXT = 24_000;
export const MAX_CHATGPT_PROJECT_CONTEXT = 16_000;
export const MAX_CHATGPT_COMBINED_CONTEXT = 40_000;

export const CHATGPT_QUICK_CHAT_REFRESH_INTERVALS = Object.freeze([
  Object.freeze({ id: 'off', label: 'Manual only', milliseconds: null }),
  Object.freeze({ id: 'always', label: 'Every Quick Chat', milliseconds: 0 }),
  Object.freeze({ id: '3h', label: 'Every 3 hours', milliseconds: 3 * 60 * 60_000 }),
  Object.freeze({ id: '12h', label: 'Every 12 hours', milliseconds: 12 * 60 * 60_000 }),
  Object.freeze({ id: '1d', label: 'Every day', milliseconds: 24 * 60 * 60_000 }),
  Object.freeze({ id: '3d', label: 'Every 3 days', milliseconds: 3 * 24 * 60 * 60_000 }),
  Object.freeze({ id: '7d', label: 'Every 7 days', milliseconds: 7 * 24 * 60 * 60_000 })
]);

const CHATGPT_REFRESH_INTERVAL_BY_ID = new Map(
  CHATGPT_QUICK_CHAT_REFRESH_INTERVALS.map((interval) => [interval.id, interval])
);

const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);
const CHATGPT_PERSONALIZATION_MARKERS = Object.freeze([
  /^personalization$/i,
  /^base style and tone$/i,
  /^characteristics$/i,
  /^suggested prompts$/i,
  /^custom instructions$/i,
  /^pet$/i,
  /^select pet$/i,
  /^about you$/i,
  /^nickname$/i,
  /^occupation$/i,
  /^enable memory$/i,
  /^record mode$/i,
  /^reference record history$/i,
  /^advanced$/i
]);

function cleanText(value, limit) {
  const normalized = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return normalized.slice(0, limit);
}

export function isChatGptWebUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && CHATGPT_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function safeChatGptWebUrl(value) {
  if (!isChatGptWebUrl(value)) return '';
  const url = new URL(String(value));
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.href;
}

export function normalizeChatGptQuickChatRefreshInterval(value) {
  const id = String(value || 'off');
  return CHATGPT_REFRESH_INTERVAL_BY_ID.has(id) ? id : 'off';
}

// This intentionally relies on stable visible labels rather than ChatGPT's
// volatile DOM structure. Apart from protecting new imports, keeping it in the
// core normalizer migrates previously cached Personalization-page captures out
// of storage before they can enter a provider prompt.
export function chatGptMemoryLooksLikePersonalizationPage(value) {
  const lines = cleanText(value, MAX_CHATGPT_MEMORY_CONTEXT)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const matches = CHATGPT_PERSONALIZATION_MARKERS
    .filter((pattern) => lines.some((line) => pattern.test(line)));
  const explicitlyPersonalization = lines.some((line) => /^personalization$/i.test(line));
  // DOM changes can cause the extractor to see only the Memory card instead
  // of the whole Personalization page. Detect that smaller settings surface
  // by its paired control/description copy as well as the full-page markers.
  const memorySettingsControl = lines.some((line) => /^enable memory$/i.test(line));
  const memorySettingsDescription = lines.some((line) => (
    /view an overview of what chatgpt has learned about you/i.test(line)
    || /let chatgpt personalize your experience based on your chats, files, and connected apps/i.test(line)
  ));
  return (memorySettingsControl && memorySettingsDescription)
    || matches.length >= 4
    || (explicitlyPersonalization && matches.length >= 2);
}

export function chatGptQuickChatRefreshIntervalMilliseconds(raw = {}) {
  const context = normalizeChatGptWebContext(raw);
  return CHATGPT_REFRESH_INTERVAL_BY_ID.get(context.quickChatRefreshInterval)?.milliseconds
    ?? null;
}

export function normalizeChatGptWebContext(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const cachedMemory = cleanText(source.memory, MAX_CHATGPT_MEMORY_CONTEXT);
  const memory = chatGptMemoryLooksLikePersonalizationPage(cachedMemory) ? '' : cachedMemory;
  const projectContext = cleanText(source.projectContext, MAX_CHATGPT_PROJECT_CONTEXT);
  const projectName = cleanText(source.projectName, 180).replace(/\n/g, ' ');
  const updatedAt = Number(source.updatedAt);
  // An empty or rejected snapshot is never "fresh". Resetting this timestamp
  // makes the next scheduled Quick Chat fetch retry immediately instead of
  // waiting hours behind the poisoned capture's old success timestamp.
  const fetchedAt = Number(memory ? source.fetchedAt ?? source.updatedAt : 0);
  return {
    enabled: source.enabled === true,
    autoUseOnChatGpt: source.autoUseOnChatGpt !== false,
    quickChatRefreshInterval: normalizeChatGptQuickChatRefreshInterval(
      source.quickChatRefreshInterval
    ),
    memory,
    projectName,
    projectUrl: safeChatGptWebUrl(source.projectUrl),
    projectContext,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : 0,
    fetchedAt: Number.isFinite(fetchedAt) && fetchedAt > 0 ? Math.floor(fetchedAt) : 0
  };
}

export function chatGptQuickChatRefreshIsDue(raw = {}, now = Date.now()) {
  const context = normalizeChatGptWebContext(raw);
  const interval = CHATGPT_REFRESH_INTERVAL_BY_ID.get(context.quickChatRefreshInterval);
  if (!interval || interval.milliseconds === null) return false;
  if (interval.milliseconds === 0 || !context.fetchedAt) return true;
  const timestamp = Number(now);
  if (!Number.isFinite(timestamp)) return false;
  return timestamp - context.fetchedAt >= interval.milliseconds;
}

export function chatGptWebContextAvailable(raw = {}) {
  const context = normalizeChatGptWebContext(raw);
  return Boolean(context.memory || context.projectContext);
}

export function publicChatGptWebContext(raw = {}) {
  const context = normalizeChatGptWebContext(raw);
  return {
    enabled: context.enabled,
    autoUseOnChatGpt: context.autoUseOnChatGpt,
    quickChatRefreshInterval: context.quickChatRefreshInterval,
    available: chatGptWebContextAvailable(context),
    hasMemory: Boolean(context.memory),
    hasProject: Boolean(context.projectContext),
    projectName: context.projectName,
    updatedAt: context.updatedAt,
    fetchedAt: context.fetchedAt
  };
}

function projectId(value) {
  if (!isChatGptWebUrl(value)) return '';
  return /(?:^|\/)g\/(g-p-[^/]+)/i.exec(new URL(value).pathname)?.[1]?.toLowerCase() || '';
}

function formatContextSections(context, { includeProject = true } = {}) {
  const sections = [];
  if (context.memory) sections.push(`ChatGPT memory snapshot:\n${context.memory}`);
  if (includeProject && context.projectContext) {
    const heading = context.projectName
      ? `ChatGPT project snapshot — ${context.projectName}:`
      : 'ChatGPT project snapshot:';
    sections.push(`${heading}\n${context.projectContext}`);
  }
  return sections.join('\n\n').slice(0, MAX_CHATGPT_COMBINED_CONTEXT);
}

export function formatChatGptWebContext(raw = {}) {
  const context = normalizeChatGptWebContext(raw);
  return formatContextSections(context);
}

export function formatChatGptWebContextForPage(raw = {}, pageUrl = '') {
  const context = normalizeChatGptWebContext(raw);
  if (!context.autoUseOnChatGpt || !isChatGptWebUrl(pageUrl)) return '';
  const currentProject = projectId(pageUrl);
  const savedProject = projectId(context.projectUrl);
  return formatContextSections(context, {
    includeProject: Boolean(currentProject && savedProject && currentProject === savedProject)
  });
}
