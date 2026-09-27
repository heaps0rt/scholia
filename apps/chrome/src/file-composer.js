import { MAX_FILE_ATTACHMENTS, MAX_TURN_FILE_TEXT } from '../../../packages/core/src/file-attachments.js';
import { readChatFile } from './file-input.js';

export const PAPERCLIP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8L15 6"/></svg>';

export function appendFileChips(container, files = [], remove = null) {
  const doc = container.ownerDocument;
  for (const [index, file] of files.entries()) {
    const chip = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span');
    chip.className = 'scholia-file-chip';
    if (file.imageDataUrl) {
      const image = doc.createElementNS('http://www.w3.org/1999/xhtml', 'img');
      image.src = file.imageDataUrl;
      image.alt = '';
      chip.append(image);
    }
    const name = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span');
    name.textContent = file.name;
    name.title = `${file.name}${file.truncated ? ' · Partial text' : ''}`;
    chip.append(name);
    if (file.truncated) {
      const note = doc.createElementNS('http://www.w3.org/1999/xhtml', 'small');
      note.textContent = 'Partial';
      chip.append(note);
    }
    if (remove) {
      const button = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button');
      button.type = 'button';
      button.textContent = '×';
      button.setAttribute('aria-label', `Remove ${file.name}`);
      button.addEventListener('click', () => remove(index));
      chip.append(button);
    }
    container.append(chip);
  }
}

export function mountFileComposer({ button, container, dropTarget, pasteTarget, disabled = () => false, onChange = () => {} }) {
  const doc = container.ownerDocument;
  const input = doc.createElementNS('http://www.w3.org/1999/xhtml', 'input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  button.innerHTML = PAPERCLIP;
  button.title = 'Attach files';
  button.setAttribute('aria-label', 'Attach files');
  const list = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  list.className = 'scholia-file-list';
  const status = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  status.className = 'scholia-file-status';
  status.setAttribute('role', 'status');
  container.append(list, status, input);
  let files = [];
  let busy = false;
  let version = 0;
  let controller;
  let dragDepth = 0;
  function render() {
    list.replaceChildren();
    appendFileChips(list, files, (index) => {
      if (disabled() || busy) return;
      files.splice(index, 1);
      status.textContent = '';
      render();
    });
    container.hidden = !files.length && !status.textContent;
    onChange();
  }
  async function add(candidates) {
    if (disabled() || busy) return;
    const token = ++version;
    controller = new AbortController();
    busy = true;
    status.textContent = 'Reading files…';
    render();
    const errors = [];
    for (const candidate of Array.from(candidates)) {
      if (token !== version) return;
      if (files.length >= MAX_FILE_ATTACHMENTS) { errors.push(`Attach up to ${MAX_FILE_ATTACHMENTS} files per message.`); break; }
      try {
        const file = await readChatFile(candidate, { signal: controller.signal });
        if (token !== version) return;
        if (file.imageDataUrl && files.some((entry) => entry.imageDataUrl)) throw new Error('Attach one image per message. Send another message for additional images.');
        const room = MAX_TURN_FILE_TEXT - files.reduce((sum, entry) => sum + (entry.text?.length || 0), 0);
        if (file.text && room <= 0) throw new Error('This message has reached its file text limit. Send the remaining files in another message.');
        if (file.text?.length > room) { file.text = file.text.slice(0, room); file.truncated = true; }
        files.push(file);
      } catch (error) {
        if (token !== version) return;
        errors.push(error.message || 'Could not read this file.');
      }
    }
    busy = false;
    status.textContent = errors.join(' ');
    render();
  }
  button.addEventListener('click', () => { if (!disabled() && !busy) input.click(); });
  input.addEventListener('change', () => { const chosen = [...input.files]; input.value = ''; void add(chosen); });
  const isFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
  dropTarget.addEventListener('dragenter', (event) => {
    if (!isFiles(event)) return;
    event.preventDefault(); event.stopPropagation();
    dragDepth += 1;
    if (!disabled() && !busy) dropTarget.classList.add('scholia-file-drag');
  });
  dropTarget.addEventListener('dragover', (event) => {
    if (!isFiles(event)) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = disabled() || busy ? 'none' : 'copy';
  });
  dropTarget.addEventListener('dragleave', (event) => {
    if (!isFiles(event)) return;
    event.stopPropagation();
    if (--dragDepth <= 0) dropTarget.classList.remove('scholia-file-drag');
  });
  dropTarget.addEventListener('drop', (event) => {
    if (!isFiles(event)) return;
    event.preventDefault(); event.stopPropagation();
    dragDepth = 0;
    dropTarget.classList.remove('scholia-file-drag');
    void add(event.dataTransfer.files);
  });
  pasteTarget?.addEventListener('paste', (event) => {
    const pasted = [...(event.clipboardData?.files || [])];
    if (!pasted.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void add(pasted);
  });
  render();
  return {
    get busy() { return busy; },
    get files() { return files.slice(); },
    get options() { return { files: files.filter((file) => file.text), imageDataUrl: files.find((file) => file.imageDataUrl)?.imageDataUrl || '' }; },
    set(next = []) {
      version += 1;
      controller?.abort();
      files = next.slice(); busy = false; status.textContent = ''; render();
    },
    add
  };
}
