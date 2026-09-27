export async function copyText(text, { root = document, clipboard = navigator.clipboard } = {}) {
  const doc = root.ownerDocument || root;
  try {
    // Check before calling: a rejected write still logs a Permissions-Policy
    // violation in embedded readers, even when the fallback succeeds.
    const policy = doc.permissionsPolicy || doc.featurePolicy;
    if (clipboard?.writeText && (!policy?.allowsFeature || policy.allowsFeature('clipboard-write'))) {
      await clipboard.writeText(text);
      return;
    }
  } catch { /* Sandboxed frames and page Permissions-Policy can block this API. */ }
  const parent = root.body || root;
  const focused = root.activeElement || doc.activeElement;
  const selection = root.getSelection?.() || doc.getSelection();
  const ranges = Array.from({ length: selection?.rangeCount || 0 }, (_, index) => selection.getRangeAt(index).cloneRange());
  const input = doc.createElementNS('http://www.w3.org/1999/xhtml', 'textarea');
  input.value = String(text);
  input.setAttribute('aria-label', 'Code to copy');
  input.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  const copy = (event) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', String(text));
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  try {
    parent.append(input);
    input.focus({ preventScroll: true });
    input.select();
    root.addEventListener('copy', copy, true);
    if (!doc.execCommand('copy')) throw new Error('The browser could not copy this code. Select the code and copy it manually.');
  } finally {
    root.removeEventListener('copy', copy, true);
    input.remove();
    focused?.focus?.({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) { try { selection.addRange(range); } catch {} }
    }
  }
}

export async function copyCodeBlock(event, onError = () => {}) {
  const button = event.target.closest?.('[data-copy-code]');
  if (!button) return false;
  event.preventDefault();
  event.stopPropagation();
  const code = button.closest('.scholia-code')?.querySelector('pre code');
  if (!code) return false;
  try {
    await copyText(code.textContent, { root: button.getRootNode() });
    button.textContent = 'Copied';
    button.setAttribute('aria-label', 'Code copied');
  } catch (error) {
    button.textContent = 'Copy failed';
    button.setAttribute('aria-label', 'Copy failed. Try again');
    onError(error);
  }
  setTimeout(() => {
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code block');
  }, 1600);
  return true;
}
