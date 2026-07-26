export function sendRuntimeMessage(payload, fallbackMessage = 'Scholia could not complete the request.') {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || fallbackMessage));
        return;
      }
      resolve(response.value);
    });
  });
}
