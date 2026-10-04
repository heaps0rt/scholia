import { renderMarkdown, renderActivity, escapeHtml as esc } from '../chrome/src/render.js';
import {
  teachingModes,
  coursePrompts,
  conversationScope,
  studyRenderKey,
} from './study-session.js';

function messageMarkup(message, sources, streaming) {
  const action = (title, name) =>
    `<button data-action="${name}" data-id="${esc(message.id)}">${title}</button>`;
  return `<div class="message-label">${message.role === 'user' ? 'YOU' : '✧ SCHOLIA'} ${message.isStreaming ? '· THINKING WITH YOU' : ''}</div>
    ${message.imageData ? `<img alt="Question attachment" src="data:image/jpeg;base64,${esc(message.imageData)}">` : ''}
    ${message.reasoning ? `<details data-detail="reasoning"><summary>Reasoning</summary>${renderMarkdown(message.reasoning)}</details>` : ''}
    ${activityMarkup(message.activity)}
    <div>${renderMarkdown(message.content || '')}</div>
    ${message.isStreaming ? `<div class="generation-progress" role="status"><span class="generation-progress-label">${esc(message.metadata || 'Preparing your answer…')}</span><span class="generation-elapsed" aria-hidden="true"></span></div>` : ''}
    ${sources.length ? `<details data-detail="sources"><summary>${sources.length} pages provided</summary><div class="source-chips">${sources.map((source) => `<button data-source="${esc(source.documentID)}" data-page="${source.page}" title="${esc(source.title)}">${esc(source.title.slice(0, 24))} · p. ${source.page}</button>`).join('')}</div></details>` : ''}
    <div class="message-actions">${action('Copy', 'copy')}${message.role === 'user' && !streaming ? action('Edit', 'edit') : ''}</div>`;
}

export function activityMarkup(events = []) {
  return renderActivity(events);
}

export class StudyConversation {
  constructor(host) {
    this.host = host;
    this.entries = new Map();
  }

  render(state) {
    const { host } = this;
    const changedThread = this.thread !== state.library.selectedThreadID;
    const atBottom = changedThread || host.scrollHeight - host.scrollTop - host.clientHeight < 90;
    this.thread = state.library.selectedThreadID;
    if (!state.messages.length) {
      const scope = conversationScope(state);
      if (this.entries.size || !host.querySelector('.tutor-empty') || this.emptyScope !== scope) {
        this.entries.clear();
        this.emptyScope = scope;
        host.innerHTML =
          scope === 'course'
            ? `<div class="tutor-empty"><h3>Your whole course,<br>in view.</h3><p>Explore topics, assignments, deadlines, and connections between readings. Start with a question about your course.</p>${coursePrompts.map(({ id, title }) => `<button data-course-prompt="${id}">${title}<span aria-hidden="true">↗</span></button>`).join('')}</div>`
            : `<div class="tutor-empty"><h3>What would you like<br>to understand?</h3><p>Explore an idea, work through an example, or test what you remember. Choose a starting point and make it your own.</p>${teachingModes.map(({ mode, title }) => `<button data-study-prompt="${esc(mode)}">${title}<span aria-hidden="true">↗</span></button>`).join('')}</div>`;
      }
      return;
    }
    host.querySelector('.tutor-empty')?.remove();
    const ids = new Set(state.messages.map((message) => message.id));
    for (const [id, entry] of this.entries) {
      if (!ids.has(id)) {
        entry.node.remove();
        this.entries.delete(id);
      }
    }
    let previous = null;
    for (const message of state.messages) {
      const sources = state.sources[message.id] || [];
      const key = studyRenderKey([message, sources, message.role === 'user' && state.streaming]);
      let entry = this.entries.get(message.id);
      if (!entry) {
        const node = host.ownerDocument.createElement('article');
        node.className = `message ${message.role === 'user' ? 'user' : 'assistant'}`;
        node.dataset.messageId = message.id;
        entry = { node };
        this.entries.set(message.id, entry);
      }
      if (entry.key !== key) {
        const open = new Set(
          [...entry.node.querySelectorAll('details[open]')].map((node) => node.dataset.detail)
        );
        entry.node.innerHTML = messageMarkup(message, sources, state.streaming);
        for (const details of entry.node.querySelectorAll('details'))
          details.open = open.has(details.dataset.detail);
        entry.key = key;
      }
      const elapsed = entry.node.querySelector('.generation-elapsed');
      if (elapsed && state.answerStartedAt) {
        elapsed.textContent = `${Math.max(0, Math.floor(Date.now() / 1000 - state.answerStartedAt))}s`;
      }
      const next = previous ? previous.nextElementSibling : host.firstElementChild;
      if (next !== entry.node) host.insertBefore(entry.node, next);
      previous = entry.node;
    }
    if (atBottom) host.scrollTop = host.scrollHeight;
  }
}
