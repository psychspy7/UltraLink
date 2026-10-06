'use client';

export interface LocalMessageRecord {
  id: string;
  ownerId?: string;
  direction: 'sent' | 'received';
  text: string;
  timestamp: number;
  payloadLength: number;
  profileUsed: string;
  status: 'delivered' | 'decoded' | 'crc_failed';
  crcPassed: boolean;
  durationMs: number;
  sampleRate: number;
  snrDb?: number;
  crcValue?: string;
}

const DB_NAME = 'ultralink_vault';
const STORE_NAME = 'messages';
const DB_VERSION = 1;
const STORAGE_KEY = 'ultralink_local_history';

/**
 * Open IndexedDB safely with graceful degradation to localStorage
 */
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Add a message record to local offline vault
 */
export async function saveMessageRecord(record: LocalMessageRecord): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return;
    } catch {
      // Fallback below
    }
  }

  // LocalStorage Fallback
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list: LocalMessageRecord[] = raw ? JSON.parse(raw) : [];
      list.unshift(record);
      // Keep up to 1000 items
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 1000)));
    } catch {
      // Ignore quota errors
    }
  }
}

/**
 * Retrieve all message records from local offline vault.
 * If ownerId is provided, returns only messages matching that ownerId.
 */
export async function getMessageRecords(ownerId?: string): Promise<LocalMessageRecord[]> {
  let records: LocalMessageRecord[] = [];
  const db = await openDb();
  if (db) {
    try {
      records = await new Promise<LocalMessageRecord[]>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
          const res = (request.result || []) as LocalMessageRecord[];
          res.sort((a, b) => b.timestamp - a.timestamp);
          resolve(res);
        };
        request.onerror = () => resolve([]);
      });
    } catch {
      // Fallback below
    }
  }

  // LocalStorage Fallback
  if (records.length === 0 && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const list: LocalMessageRecord[] = JSON.parse(raw);
        list.sort((a, b) => b.timestamp - a.timestamp);
        records = list;
      }
    } catch {
      records = [];
    }
  }

  if (ownerId) {
    records = records.filter(m => m.ownerId === ownerId);
  }

  return records;
}

/**
 * Clear local vault
 */
export async function clearMessageRecords(): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // Ignore
    }
  }

  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

/**
 * Delete a specific message record
 */
export async function deleteMessageRecord(id: string): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // Ignore
    }
  }

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const list: LocalMessageRecord[] = JSON.parse(raw);
        const filtered = list.filter((item) => item.id !== id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      }
    } catch {
      // Ignore
    }
  }
}
