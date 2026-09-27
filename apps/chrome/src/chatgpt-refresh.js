import {
  chatGptQuickChatRefreshIsDue,
  normalizeChatGptWebContext
} from '../../../packages/core/src/chatgpt-context.js';
import { chatGptMemoryTextIsUsable } from './chatgpt-web.js';

export function chatGptQuickChatRefreshDecision(rawContext, {
  force = false,
  now = Date.now()
} = {}) {
  const context = normalizeChatGptWebContext(rawContext);
  return {
    context,
    enabled: context.quickChatRefreshInterval !== 'off',
    due: force || chatGptQuickChatRefreshIsDue(context, now)
  };
}

export function chatGptContextAfterMemoryRefresh(rawContext, state, now = Date.now()) {
  const previous = normalizeChatGptWebContext(rawContext);
  const memory = String(state?.memoryText || '').trim();
  if (!chatGptMemoryTextIsUsable(memory)) {
    throw new Error('ChatGPT did not expose a valid rendered memory summary.');
  }
  const timestamp = Number.isFinite(Number(now)) && Number(now) > 0
    ? Math.floor(Number(now))
    : Date.now();
  const projectUrl = state?.projectUrl || previous.projectUrl;
  return normalizeChatGptWebContext({
    ...previous,
    memory,
    projectName: projectUrl ? state?.projectName || previous.projectName : previous.projectName,
    projectUrl,
    updatedAt: timestamp,
    fetchedAt: timestamp
  });
}
