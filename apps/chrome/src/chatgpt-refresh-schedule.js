import {
  chatGptQuickChatRefreshIntervalMilliseconds,
  normalizeChatGptWebContext
} from '../../../packages/core/src/chatgpt-context.js';

export const CHATGPT_CONTEXT_REFRESH_ALARM = 'scholia-chatgpt-context-refresh';

export function chatGptContextRefreshAlarmSchedule(rawContext, now = Date.now()) {
  const context = normalizeChatGptWebContext(rawContext);
  const intervalMilliseconds = chatGptQuickChatRefreshIntervalMilliseconds(context);
  if (!Number.isFinite(intervalMilliseconds) || intervalMilliseconds <= 0) return null;

  const timestamp = Number(now);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const dueAt = context.fetchedAt
    ? context.fetchedAt + intervalMilliseconds
    : timestamp;
  return {
    when: Math.max(timestamp + 1_000, dueAt),
    periodInMinutes: intervalMilliseconds / 60_000
  };
}
