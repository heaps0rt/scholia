import { renderMarkdown, escapeHtml as esc } from '../chrome/src/render.js';
import { teachingModes, studyRenderKey } from './study-session.js';

function messageMarkup(message, sources, streaming) {
  const action = (title, name) =>
    `<button data-action="${name}" data-id="${esc(message.id)}">${title}</button>`;
  return `<div class="message-label">${message.role === 'user' ? 'YOU' : '✧ SCHOLIA'} ${message.isStreaming ? '· THINKING WITH YOU' : ''}</div>
    ${message.imageData ? `<img alt="Question attachment" src="data:image/jpeg;base64,${esc(message.imageData)}">` : ''}
    ${message.reasoning ? `<details data-detail="reasoning"><summary>Reasoning</summary>${renderMarkdown(message.reasoning)}</details>` : ''}
    <div>${renderMarkdown(message.content || (message.isStreaming ? 'Thinking…' : ''))}</div>
    ${sources.length ? `<details data-detail="sources"><summary>${sources.length} pages provided</summary><div class="source-chips">${sources.map((source) => `<button data-source="${esc(source.documentID)}" data-page="${source.page}" title="${esc(source.title)}">${esc(source.title.slice(0, 24))} · p. ${source.page}</button>`).join('')}</div></details>` : ''}
    <div class="message-actions">${action('Copy', 'copy')}${message.role === 'user' && !streaming ? action('Edit', 'edit') : ''}</div>`;
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
      if (this.entries.size || !host.querySelector('.tutor-empty')) {
        this.entries.clear();
        host.innerHTML = `<div class="tutor-empty"><h3>What would you like<br>to understand?</h3><p>Explore an idea, work through an example, or test what you remember. Choose a starting point and make it your own.</p>${teachingModes.map(({ mode, title }) => `<button data-study-prompt="${esc(mode)}">${title}<span aria-hidden="true">↗</span></button>`).join('')}</div>`;
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
      const next = previous ? previous.nextElementSibling : host.firstElementChild;
      if (next !== entry.node) host.insertBefore(entry.node, next);
      previous = entry.node;
    }
    if (atBottom) host.scrollTop = host.scrollHeight;
  }
}
