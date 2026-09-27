const DATABASE = 'scholia-canvas-courses';

async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('courses', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('courses', mode);
      const request = action(transaction.objectStore('courses'));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Course storage failed.'));
    });
  } finally { db.close(); }
}

export const readCanvasIndex = (key) => transact('readonly', (store) => store.get(key));
export const deleteCanvasIndex = (key) => transact('readwrite', (store) => store.delete(key));

export async function saveCanvasIndex(index) {
  await transact('readwrite', (store) => store.put(index));
  const records = await transact('readonly', (store) => store.getAll());
  records.sort((a, b) => b.updatedAt - a.updatedAt);
  for (const record of records.slice(8)) await deleteCanvasIndex(record.key);
}
