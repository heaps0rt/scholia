async function bootDedicatedChat() {
  const response = await fetch(chrome.runtime.getURL('panel.html'));
  if (!response.ok) throw new Error('The shared chat interface could not be loaded.');
  const source = new DOMParser().parseFromString(await response.text(), 'text/html');
  const nodes = [...source.body.children]
    .filter((node) => node.tagName !== 'SCRIPT')
    .map((node) => document.importNode(node, true));
  document.body.replaceChildren(...nodes);
  document.body.classList.add('dedicated-chat');
  await import(chrome.runtime.getURL('panel.js'));
}

bootDedicatedChat().catch((error) => {
  const failure = document.createElement('main');
  failure.className = 'dedicated-chat-failure';
  const title = document.createElement('strong');
  title.textContent = 'Scholia Chat could not open';
  const detail = document.createElement('p');
  detail.textContent = error?.message || String(error);
  failure.append(title, detail);
  document.body.replaceChildren(failure);
});
