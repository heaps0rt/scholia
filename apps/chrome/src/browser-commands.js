export function toggleQuickChatFromCommandTab(tab, actions = {}) {
  const windowId = tab?.windowId;
  if (!Number.isInteger(windowId)
      || typeof actions.probePanel !== 'function'
      || typeof actions.openForWindow !== 'function') return null;

  // Both requests must start inside the command event. The probe reaches only
  // a panel that was already open, while openForWindow retains the shortcut's
  // user activation when there is no panel.
  let panelProbe;
  let opening;
  try {
    panelProbe = actions.probePanel();
    opening = actions.openForWindow(windowId);
  } catch (error) {
    return Promise.reject(error);
  }

  return Promise.resolve(panelProbe)
    .catch(() => null)
    .then(async (response) => {
      if (response?.open === true && typeof actions.signalClose === 'function') {
        // Let the redundant open settle before asking the existing panel to
        // close itself. This prevents an older open request from reopening it.
        await Promise.resolve(opening).catch(() => {});
        const closed = await closeQuickChatFromSignal(actions.signalClose);
        return closed ? 'closed' : 'unchanged';
      }
      await Promise.all([
        opening,
        typeof actions.prepareOpen === 'function' ? actions.prepareOpen(windowId) : undefined
      ]);
      return 'opened';
    });
}

export async function closeQuickChatFromSignal(signalClose) {
  if (typeof signalClose !== 'function') return false;
  const response = await Promise.resolve(signalClose()).catch(() => null);
  return response?.closed === true;
}
