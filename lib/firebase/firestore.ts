/**
 * UltraLink Cloud Firestore Subsystem & 5-Collection Data Layer
 * File: lib/firebase/firestore.ts
 *
 * Implements persistent offline multi-tab caching and CRUD operations across 5 collections:
 * 1. profiles/{userId}
 * 2. preferences/{userId}
 * 3. message_history/{messageId} (STRICT PRIVACY: Zero plaintext storage)
 * 4. devices/{deviceId}
 * 5. feedback/{feedbackId}
 *
 * Dual-Mode Engine: Uses modular Firestore SDK with persistentLocalCache when configured;
 * transparently routes to MockFirebaseService when offline or in demo mode.
 */

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit as fbLimit,
  getDocs,
  type Firestore
} from 'firebase/firestore';
import { app, isFirebaseConfigured } from './config';
import {
  mockService,
  type UserProfileData,
  type UserPreferencesData,
  type MessageHistoryTelemetryData,
  type DeviceTelemetryData,
  type FeedbackData
} from './mock-service';


let realDbInstance: Firestore | null = null;

export function getFirestoreDb(): Firestore | null {
  if (typeof window === 'undefined' || !isFirebaseConfigured() || !app) {
    return null;
  }

  if (!realDbInstance) {
    try {
      realDbInstance = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      });
    } catch (e) {
      console.warn('[UltraLink Firestore] Firestore cache initialization warning, falling back to mock:', e);
      return null;
    }
  }

  return realDbInstance;
}

export const db = typeof window !== 'undefined' && isFirebaseConfigured() ? getFirestoreDb() : null;

// ============================================================================
// 1. PROFILES COLLECTION
// ============================================================================

export async function getUserProfile(userId: string): Promise<UserProfileData | null> {
  const firestore = getFirestoreDb();
  if (firestore) {
    try {
      const docRef = doc(firestore, 'profiles', userId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data() as UserProfileData;
      }
    } catch (e) {
      console.warn('[UltraLink Firestore] getUserProfile real error, falling back to mock:', e);
    }
  }

  const mockData = await mockService.getDoc('profiles', userId);
  return mockData as UserProfileData | null;
}

export async function saveUserProfile(userId: string, data: Partial<UserProfileData>): Promise<void> {
  const firestore = getFirestoreDb();
  const updatePayload = {
    ...data,
    userId,
    updatedAt: Date.now()
  };

  if (firestore) {
    try {
      const docRef = doc(firestore, 'profiles', userId);
      await setDoc(docRef, updatePayload, { merge: true });
      return;
    } catch (e) {
      console.warn('[UltraLink Firestore] saveUserProfile real error, falling back to mock:', e);
    }
  }

  await mockService.setDoc('profiles', userId, updatePayload, true);
}

// ============================================================================
// 2. PREFERENCES COLLECTION
// ============================================================================

export async function getUserPreferences(userId: string): Promise<UserPreferencesData | null> {
  const firestore = getFirestoreDb();
  if (firestore) {
    try {
      const docRef = doc(firestore, 'preferences', userId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data() as UserPreferencesData;
      }
    } catch (e) {
      console.warn('[UltraLink Firestore] getUserPreferences real error, falling back to mock:', e);
    }
  }

  const mockData = await mockService.getDoc('preferences', userId);
  return mockData as UserPreferencesData | null;
}

export async function saveUserPreferences(userId: string, prefs: Partial<UserPreferencesData>): Promise<void> {
  const firestore = getFirestoreDb();
  const updatePayload = {
    ...prefs,
    userId,
    updatedAt: Date.now()
  };

  if (firestore) {
    try {
      const docRef = doc(firestore, 'preferences', userId);
      await setDoc(docRef, updatePayload, { merge: true });
      return;
    } catch (e) {
      console.warn('[UltraLink Firestore] saveUserPreferences real error, falling back to mock:', e);
    }
  }

  await mockService.setDoc('preferences', userId, updatePayload, true);
}

// ============================================================================
// 3. MESSAGE HISTORY COLLECTION (PRIVACY TELEMETRY - ZERO PLAINTEXT)
// ============================================================================

/**
 * Logs privacy-preserving acoustic transmission telemetry.
 * GUARANTEE: Plaintext text is strictly stripped out and never written to Firestore.
 */
export async function logMessageTelemetry(telemetry: MessageHistoryTelemetryData): Promise<string> {
  // Architectural Privacy Enforcer: Throw error if plaintext fields are detected
  const anyTelemetry = telemetry as Record<string, any>;
  const forbiddenPlaintextFields = [
    'text',
    'content',
    'message',
    'body',
    'plaintextContent',
    'payload',
    'rawBytes',
    'data',
  ];
  for (const field of forbiddenPlaintextFields) {
    if (anyTelemetry[field] !== undefined && anyTelemetry[field] !== null) {
      throw new Error('Architectural Privacy Violation: Plaintext message text is forbidden from Cloud Firestore');
    }
  }

  const cleanTelemetry: MessageHistoryTelemetryData = {
    messageId: telemetry.messageId || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    ownerId: telemetry.ownerId,
    direction: telemetry.direction,
    timestamp: telemetry.timestamp || Date.now(),
    payloadLength: Math.max(0, telemetry.payloadLength || 0),
    status: telemetry.status || 'success',
    profileUsed: telemetry.profileUsed || 'balanced',
    sampleRate: telemetry.sampleRate || 48000,
    frequencyRange: telemetry.frequencyRange || '17.1kHz - 18.3kHz',
    durationMs: telemetry.durationMs || 0,
    crcPassed: Boolean(telemetry.crcPassed),
    snrEstimate: telemetry.snrEstimate ?? null,
    packetCount: telemetry.packetCount ?? 1,
    duplicatePacketsDetected: telemetry.duplicatePacketsDetected ?? 0,
    clientLocalRefId: telemetry.clientLocalRefId
  };

  const firestore = getFirestoreDb();
  if (firestore) {
    try {
      const docRef = doc(firestore, 'message_history', cleanTelemetry.messageId);
      await setDoc(docRef, cleanTelemetry);
      return cleanTelemetry.messageId;
    } catch (e) {
      console.warn('[UltraLink Firestore] logMessageTelemetry real error, falling back to mock:', e);
    }
  }

  await mockService.setDoc('message_history', cleanTelemetry.messageId, cleanTelemetry);
  return cleanTelemetry.messageId;
}

export async function getUserMessageTelemetry(userId: string, limitCount: number = 50): Promise<MessageHistoryTelemetryData[]> {
  const firestore = getFirestoreDb();
  if (firestore) {
    try {
      const colRef = collection(firestore, 'message_history');
      const q = query(
        colRef,
        where('ownerId', '==', userId),
        orderBy('timestamp', 'desc'),
        fbLimit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => d.data() as MessageHistoryTelemetryData);
    } catch (e) {
      console.warn('[UltraLink Firestore] getUserMessageTelemetry real error, falling back to mock:', e);
    }
  }

  const items = await mockService.getDocs('message_history', (m: MessageHistoryTelemetryData) => m.ownerId === userId);
  return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, limitCount) as MessageHistoryTelemetryData[];
}

export async function getAllTelemetry(limitCount: number = 100): Promise<MessageHistoryTelemetryData[]> {
  const firestore = getFirestoreDb();
  if (firestore) {
    try {
      const colRef = collection(firestore, 'message_history');
      const q = query(colRef, orderBy('timestamp', 'desc'), fbLimit(limitCount));
      const snap = await getDocs(q);
      return snap.docs.map(d => d.data() as MessageHistoryTelemetryData);
    } catch (e) {
      console.warn('[UltraLink Firestore] getAllTelemetry real error, falling back to mock:', e);
    }
  }

  const items = await mockService.getDocs('message_history');
  return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, limitCount) as MessageHistoryTelemetryData[];
}

// ============================================================================
// 4. DEVICES COLLECTION
// ============================================================================

export async function registerOrUpdateDevice(device: DeviceTelemetryData): Promise<void> {
  const firestore = getFirestoreDb();
  const payload: DeviceTelemetryData = {
    ...device,
    lastActive: Date.now(),
    createdAt: device.createdAt || Date.now()
  };

  if (firestore) {
    try {
      const docRef = doc(firestore, 'devices', device.deviceId);
      await setDoc(docRef, payload, { merge: true });
      return;
    } catch (e) {
      console.warn('[UltraLink Firestore] registerOrUpdateDevice real error, falling back to mock:', e);
    }
  }

  await mockService.setDoc('devices', device.deviceId, payload, true);
}

export async function getAllDevices(): Promise<DeviceTelemetryData[]> {
  const firestore = getFirestoreDb();
  if (firestore) {
    try {
      const colRef = collection(firestore, 'devices');
      const snap = await getDocs(colRef);
      return snap.docs.map(d => d.data() as DeviceTelemetryData);
    } catch (e) {
      console.warn('[UltraLink Firestore] getAllDevices real error, falling back to mock:', e);
    }
  }

  const items = await mockService.getDocs('devices');
  return items as DeviceTelemetryData[];
}

// ============================================================================
// 5. FEEDBACK COLLECTION
// ============================================================================

export async function submitFeedback(
  feedback: Omit<FeedbackData, 'feedbackId' | 'status' | 'createdAt'>
): Promise<string> {
  const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const payload: FeedbackData = {
    ...feedback,
    feedbackId,
    status: 'new',
    createdAt: Date.now()
  };

  const firestore = getFirestoreDb();
  if (firestore) {
    try {
      const docRef = doc(firestore, 'feedback', feedbackId);
      await setDoc(docRef, payload);
      return feedbackId;
    } catch (e) {
      console.warn('[UltraLink Firestore] submitFeedback real error, falling back to mock:', e);
    }
  }

  await mockService.setDoc('feedback', feedbackId, payload);
  return feedbackId;
}

export async function getAllFeedback(): Promise<FeedbackData[]> {
  const firestore = getFirestoreDb();
  if (firestore) {
    try {
      const colRef = collection(firestore, 'feedback');
      const q = query(colRef, orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => d.data() as FeedbackData);
    } catch (e) {
      console.warn('[UltraLink Firestore] getAllFeedback real error, falling back to mock:', e);
    }
  }

  const items = await mockService.getDocs('feedback');
  return items.sort((a, b) => b.createdAt - a.createdAt) as FeedbackData[];
}

export async function updateFeedbackStatus(
  feedbackId: string,
  status: 'new' | 'reviewed' | 'resolved'
): Promise<void> {
  const firestore = getFirestoreDb();
  if (firestore) {
    try {
      const docRef = doc(firestore, 'feedback', feedbackId);
      await updateDoc(docRef, { status });
      return;
    } catch (e) {
      console.warn('[UltraLink Firestore] updateFeedbackStatus real error, falling back to mock:', e);
    }
  }

  await mockService.updateDoc('feedback', feedbackId, { status });
}
