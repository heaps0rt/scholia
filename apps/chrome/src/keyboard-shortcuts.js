export function isQuickChatShortcut(event, platform = globalThis.navigator?.platform || '') {
  if (!event || event.repeat || event.altKey || !event.shiftKey || String(event.key || '').toLowerCase() !== 'k') return false;
  const mac = /mac|iphone|ipad|ipod/i.test(String(platform));
  return mac
    ? Boolean(event.metaKey && !event.ctrlKey)
    : Boolean(event.ctrlKey && !event.metaKey);
}
