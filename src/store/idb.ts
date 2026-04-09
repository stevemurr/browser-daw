// idb.ts — shared IndexedDB helpers for the DAW metadata database.
// Exports a singleton DB connection so AudioFileStore and SessionStore
// share one IDBDatabase instance and onupgradeneeded runs exactly once.

const DB_NAME    = 'daw-metadata';
const DB_VERSION = 2;

// Lazy singleton — only calls indexedDB.open() on first use, so Node test
// environments (which import this module but never call getDb()) don't crash.
let _dbPromise: Promise<IDBDatabase> | null = null;
export function getDb(): Promise<IDBDatabase> {
  _dbPromise ??= _openDB();
  return _dbPromise;
}

function _openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db         = req.result;
      const oldVersion = e.oldVersion;

      // v1 stores: files + peaks
      if (oldVersion < 1) {
        db.createObjectStore('files', { keyPath: 'fileId' });
        db.createObjectStore('peaks', { keyPath: 'fileId' });
      }
      // v2 stores: sessions
      if (oldVersion < 2) {
        const sessionsStore = db.createObjectStore('sessions', { keyPath: 'sessionId' });
        sessionsStore.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export function idbPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror   = () => reject(req.error);
  });
}

export function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror   = () => reject(req.error);
  });
}
