/**
 * UltraLink Local Private Message Vault (IndexedDB)
 * File: lib/storage/indexeddb.ts
 *
 * Implements the Absolute Architectural Privacy Guarantee:
 * - Plaintext acoustic message contents reside EXCLUSIVELY on the physical client device in IndexedDB.
 * - ZERO plaintext messages are transmitted to or stored in Cloud Firestore.
 * - Provides search, export, import, and stripping utilities for cloud telemetry synchronization.
 * - Graceful fallback to memory & localStorage when SSR or in private browsing mode.
 */

import type { MessageHistoryTelemetryData } from '../firebase/mock-service';

export interface LocalMessageRecord {
  id?: string;
  messageId: string;
  ownerId?: string;
  direction: 'transmitted' | 'received' | 'sent';
  timestamp: number;
  text: string; // Plaintext message body ONLY stored in client IndexedDB
  payloadLength: number;
  profileUsed: 'reliable' | 'balanced' | 'fast' | 'experimental' | string;
  status: 'success' | 'failed' | 'crc_mismatch' | 'corrupted' | 'cancelled' | 'delivered' | 'decoded' | 'crc_failed';
  crcPassed: boolean;
  durationMs: number;
  sampleRate: number;
  frequencyRange?: string;
  snrDb?: number;
  snrEstimate?: number | null;
  packetCount?: number;
  duplicatePacketsDetected?: number;
  clientLocalRefId?: string;
  contactName?: string;
  storedAt?: number;
}

const DB_NAME = 'ultralink_vault_db';
const DB_VERSION = 1;
const STORE_NAME = 'messages';
const LOCAL_STORAGE_FALLBACK_KEY = 'ultralink_local_vault_messages';

export class IndexedDBVault {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private memoryFallback: Map<string, LocalMessageRecord> = new Map();

  constructor() {
    if (typeof window !== 'undefined' && !window.indexedDB) {
      this.restoreLocalStorageFallback();
    }
  }

  private isIndexedDBAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
  }

  private async getDB(): Promise<IDBDatabase> {
    if (!this.isIndexedDBAvailable()) {
      throw new Error('IndexedDB not available');
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'messageId' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('direction', 'direction', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('profileUsed', 'profileUsed', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  /**
   * Stores a message into the local private vault.
   */
  public async putMessage(record: Partial<LocalMessageRecord> & { text: string }): Promise<string> {
    const messageId = record.messageId || record.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fullRecord: LocalMessageRecord = {
      messageId,
      id: messageId,
      ownerId: record.ownerId || 'local_user',
      direction: record.direction || 'transmitted',
      timestamp: record.timestamp || Date.now(),
      text: record.text,
      payloadLength: record.payloadLength ?? (new TextEncoder().encode(record.text).length),
      profileUsed: record.profileUsed || 'balanced',
      status: record.status || 'success',
      crcPassed: record.crcPassed ?? true,
      durationMs: record.durationMs || 0,
      sampleRate: record.sampleRate || 48000,
      frequencyRange: record.frequencyRange || '17.1kHz - 18.3kHz',
      snrDb: record.snrDb,
      snrEstimate: record.snrEstimate ?? record.snrDb ?? null,
      packetCount: record.packetCount ?? 1,
      duplicatePacketsDetected: record.duplicatePacketsDetected ?? 0,
      clientLocalRefId: record.clientLocalRefId,
      contactName: record.contactName,
      storedAt: Date.now()
    };

    if (this.isIndexedDBAvailable()) {
      try {
        const db = await this.getDB();
        return await new Promise<string>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(fullRecord);
          req.onsuccess = () => resolve(messageId);
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn('[IndexedDBVault] IndexedDB put failed, falling back to memory/localStorage:', err);
      }
    }

    // Memory / LocalStorage fallback
    this.memoryFallback.set(messageId, fullRecord);
    this.persistLocalStorageFallback();
    return messageId;
  }

  public async saveMessage(record: Partial<LocalMessageRecord> & { text: string }): Promise<string> {
    return this.putMessage(record);
  }

  /**
   * Retrieves a single message by ID.
   */
  public async getMessage(id: string): Promise<LocalMessageRecord | null> {
    if (this.isIndexedDBAvailable()) {
      try {
        const db = await this.getDB();
        return await new Promise<LocalMessageRecord | null>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn('[IndexedDBVault] IndexedDB get failed, falling back to memory:', err);
      }
    }

    return this.memoryFallback.get(id) || null;
  }

  /**
   * Retrieves all messages stored in the local vault, sorted by timestamp descending.
   * If ownerId is provided, returns only messages owned by that user.
   */
  public async getAllMessages(ownerId?: string): Promise<LocalMessageRecord[]> {
    let list: LocalMessageRecord[] = [];
    if (this.isIndexedDBAvailable()) {
      try {
        const db = await this.getDB();
        list = await new Promise<LocalMessageRecord[]>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => {
            const res: LocalMessageRecord[] = req.result || [];
            res.sort((a, b) => b.timestamp - a.timestamp);
            resolve(res);
          };
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn('[IndexedDBVault] IndexedDB getAll failed, falling back to memory:', err);
        list = Array.from(this.memoryFallback.values());
        list.sort((a, b) => b.timestamp - a.timestamp);
      }
    } else {
      list = Array.from(this.memoryFallback.values());
      list.sort((a, b) => b.timestamp - a.timestamp);
    }

    if (ownerId) {
      list = list.filter((m) => m.ownerId === ownerId);
    }

    return list;
  }

  /**
   * Deletes a message by ID.
   */
  public async deleteMessage(id: string): Promise<boolean> {
    if (this.isIndexedDBAvailable()) {
      try {
        const db = await this.getDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.delete(id);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        return true;
      } catch (err) {
        console.warn('[IndexedDBVault] IndexedDB delete failed:', err);
      }
    }

    const existed = this.memoryFallback.delete(id);
    this.persistLocalStorageFallback();
    return existed;
  }

  /**
   * Clears all local messages.
   */
  public async clearAllMessages(): Promise<void> {
    if (this.isIndexedDBAvailable()) {
      try {
        const db = await this.getDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn('[IndexedDBVault] IndexedDB clear failed:', err);
      }
    }

    this.memoryFallback.clear();
    this.persistLocalStorageFallback();
  }

  public async clear(): Promise<void> {
    return this.clearAllMessages();
  }

  /**
   * Searches local message texts and metadata for query matches.
   */
  public async searchMessages(queryStr: string, ownerId?: string): Promise<LocalMessageRecord[]> {
    const all = await this.getAllMessages(ownerId);
    if (!queryStr || queryStr.trim() === '') {
      return all;
    }
    const q = queryStr.toLowerCase().trim();
    return all.filter(m =>
      m.text.toLowerCase().includes(q) ||
      m.messageId.toLowerCase().includes(q) ||
      m.profileUsed.toLowerCase().includes(q) ||
      (m.contactName && m.contactName.toLowerCase().includes(q))
    );
  }

  /**
   * Exports all private local vault messages to formatted JSON for offline backup.
   */
  public async exportMessagesAsJson(ownerId?: string): Promise<string> {
    const messages = await this.getAllMessages(ownerId);
    return JSON.stringify({
      schema: 'ultralink_vault_v1',
      exportedAt: Date.now(),
      messageCount: messages.length,
      messages
    }, null, 2);
  }

  /**
   * Imports messages from offline backup JSON.
   */
  public async importMessagesFromJson(jsonStr: string): Promise<number> {
    try {
      const parsed = JSON.parse(jsonStr);
      const items: LocalMessageRecord[] = Array.isArray(parsed) ? parsed : (parsed.messages || []);
      let count = 0;
      for (const item of items) {
        if (item.text && (item.messageId || item.id)) {
          await this.putMessage(item);
          count++;
        }
      }
      return count;
    } catch (e) {
      throw new Error(`Failed to import messages: ${e instanceof Error ? e.message : 'Invalid JSON'}`);
    }
  }

  /**
   * Transforms a local message into an anonymized cloud telemetry record.
   * GUARANTEE: Completely strips out plaintext `text` and PII.
   */
  public prepareCloudTelemetry(localRecord: LocalMessageRecord, ownerId?: string): MessageHistoryTelemetryData {
    return {
      messageId: localRecord.messageId,
      ownerId: ownerId || localRecord.ownerId || 'anonymous_user',
      direction: localRecord.direction === 'sent' ? 'transmitted' : localRecord.direction,
      timestamp: localRecord.timestamp,
      payloadLength: localRecord.payloadLength,
      status: (['success', 'failed', 'crc_mismatch', 'corrupted', 'cancelled'].includes(localRecord.status)
        ? localRecord.status
        : (localRecord.crcPassed ? 'success' : 'failed')) as any,
      profileUsed: (['reliable', 'balanced', 'fast', 'experimental'].includes(localRecord.profileUsed)
        ? localRecord.profileUsed
        : 'balanced') as any,
      sampleRate: localRecord.sampleRate,
      frequencyRange: localRecord.frequencyRange || '17.1kHz - 18.3kHz',
      durationMs: localRecord.durationMs,
      crcPassed: localRecord.crcPassed,
      snrEstimate: localRecord.snrEstimate ?? localRecord.snrDb ?? null,
      packetCount: localRecord.packetCount ?? 1,
      duplicatePacketsDetected: localRecord.duplicatePacketsDetected ?? 0,
      clientLocalRefId: localRecord.messageId
    };
  }

  private persistLocalStorageFallback(): void {
    if (typeof window === 'undefined') return;
    try {
      const entries = Array.from(this.memoryFallback.entries());
      localStorage.setItem(LOCAL_STORAGE_FALLBACK_KEY, JSON.stringify(entries));
    } catch {}
  }

  private restoreLocalStorageFallback(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_FALLBACK_KEY);
      if (raw) {
        const entries: [string, LocalMessageRecord][] = JSON.parse(raw);
        for (const [k, v] of entries) {
          this.memoryFallback.set(k, v);
        }
      }
    } catch {}
  }
}

// Singleton instance
let vaultInstance: IndexedDBVault | null = null;

export function getLocalVault(): IndexedDBVault {
  if (!vaultInstance) {
    vaultInstance = new IndexedDBVault();
  }
  return vaultInstance;
}

export const localVault = getLocalVault();

// Export alias MockIndexedDBVault for test runner compatibility
export { IndexedDBVault as MockIndexedDBVault };
