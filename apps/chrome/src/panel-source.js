export async function panelSourceTab(tabs, { windowId, expectedTabId, expectedUrl } = {}) {
  const query = Number.isInteger(windowId) ? { active: true, windowId } : { active: true, currentWindow: true };
  const [tab] = await tabs.query(query);
  if (!tab?.id) throw new Error('No active page is available.');
  if ((Number.isInteger(expectedTabId) && tab.id !== expectedTabId)
      || (expectedUrl && tab.url !== expectedUrl)) {
    throw new Error('The source page changed. Return to it or use the current tab.');
  }
  return tab;
}
