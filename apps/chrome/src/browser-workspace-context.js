import { COMPACT_PACKED_CONTEXT_CHARS, packPageContext } from '../../../packages/core/src/context.js';

export const MAX_RELATED_TAB_CANDIDATES = 4;

const STOP_WORDS = new Set([
  'about', 'also', 'and', 'are', 'for', 'from', 'have', 'how', 'into', 'not', 'that',
  'the', 'their', 'there', 'these', 'this', 'what', 'when', 'where', 'which', 'with',
  'would', 'your'
]);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function terms(value, limit = 80) {
  const seen = new Set();
  const result = [];
  for (const token of clean(value).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []) {
    if (STOP_WORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    result.push(token);
    if (result.length >= limit) break;
  }
  return result;
}

function origin(value) {
  try { return new URL(value).origin; } catch { return ''; }
}

function tabScore(tab, queryTerms, activeOrigin) {
  const metadata = clean(`${tab.title || ''} ${tab.url || ''}`).toLowerCase();
  let score = tab.pinned ? 4 : 0;
  if (activeOrigin && origin(tab.url) === activeOrigin) score += 8;
  for (const term of queryTerms) {
    if (metadata.includes(term)) score += 12;
  }
  const ageMinutes = Math.max(0, (Date.now() - Number(tab.lastAccessed || 0)) / 60_000);
  if (ageMinutes < 5) score += 6;
  else if (ageMinutes < 30) score += 3;
  return score;
}

export function rankRelatedTabs(tabs, {
  activeTabId,
  activeUrl = '',
  question = '',
  visibleText = '',
  maxTabs = MAX_RELATED_TAB_CANDIDATES
} = {}) {
  const queryTerms = terms(`${question}\n${String(visibleText).slice(0, 1_500)}`);
  const activeOrigin = origin(activeUrl);
  return (Array.isArray(tabs) ? tabs : [])
    .filter((tab) => Number.isInteger(tab?.id) && tab.id !== activeTabId)
    .map((tab) => ({ tab, score: tabScore(tab, queryTerms, activeOrigin) }))
    .sort((left, right) => right.score - left.score
      || Number(right.tab.lastAccessed || 0) - Number(left.tab.lastAccessed || 0))
    .slice(0, Math.max(0, maxTabs))
    .map(({ tab }) => tab);
}

export function packCompactBrowserWorkspace({
  activeTitle = '',
  activeUrl = '',
  activeVisibleText = '',
  activeContext = '',
  relatedTabs = [],
  question = '',
  selection = '',
  maxChars = COMPACT_PACKED_CONTEXT_CHARS
} = {}) {
  const blocks = [
    [
      '[Visible on screen in the active tab]',
      activeTitle ? `Title: ${clean(activeTitle)}` : '',
      activeUrl ? `URL: ${activeUrl}` : '',
      clean(activeVisibleText) || 'No separately readable viewport text was available.'
    ].filter(Boolean).join('\n'),
    clean(activeContext) ? [
      '[Active tab source]',
      clean(activeContext)
    ].join('\n') : ''
  ];

  for (const tab of relatedTabs) {
    const text = clean(tab?.context || tab?.visibleText || '');
    if (!text) continue;
    blocks.push([
      '[Related open tab]',
      tab.title ? `Title: ${clean(tab.title)}` : '',
      tab.url ? `URL: ${tab.url}` : '',
      text
    ].filter(Boolean).join('\n'));
  }

  const corpus = blocks.filter(Boolean).join('\n\n');
  if (!corpus) return '';
  const visibleAnchor = clean(activeVisibleText).slice(0, 500);
  return packPageContext(corpus, {
    selection: [selection, visibleAnchor].filter(Boolean).join('\n'),
    question,
    maxChars,
    scopeDescription: 'the active on-screen page and the open browser tabs correlated with it',
    mapLabel: 'Screen and tab map'
  });
}
