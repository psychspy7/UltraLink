/**
 * UltraLink Mock Firebase Service & Offline Resilience Engine
 * File: lib/firebase/mock-service.ts
 *
 * Provides a 100% transparent, offline-resilient, in-memory and localStorage-backed
 * implementation of Firebase Auth and Cloud Firestore.
 *
 * Implements IAuthService and IDatabaseService interfaces with strict privacy enforcement
 * (ZERO plaintext in message_history) and security rules validation.
 */

export interface MockUser {
  uid: string;
  email: string | null;
  displayName: string;
  isAnonymous: boolean;
  role: 'user' | 'admin';
  photoURL?: string | null;
  createdAt: number;
}

export interface UserProfileData {
  userId: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  isAnonymous: boolean;
  role: 'user' | 'admin';
  createdAt: number;
  updatedAt: number;
  settings?: {
    notificationsEnabled?: boolean;
    analyticsConsent?: boolean;
    autoSaveHistory?: boolean;
  };
}

export interface UserPreferencesData {
  userId: string;
  defaultProfile: 'reliable' | 'balanced' | 'fast' | 'experimental';
  theme: 'dark' | 'light' | 'system';
  audioPreferences: {
    outputVolume: number;
    carrierFrequency: number;
    minFrequency: number;
    maxFrequency: number;
    enableAutoGainControl: boolean;
    enableEchoCancellation: boolean;
    enableNoiseSuppression: boolean;
    hapticFeedback: boolean;
    soundConfirmation: boolean;
  };
  updatedAt: number;
}

export interface MessageHistoryTelemetryData {
  messageId: string;
  ownerId: string;
  direction: 'transmitted' | 'received';
  timestamp: number;
  payloadLength: number;
  status: 'success' | 'failed' | 'crc_mismatch' | 'corrupted' | 'cancelled';
  profileUsed: 'reliable' | 'balanced' | 'fast' | 'experimental';
  sampleRate: number;
  frequencyRange?: string;
  durationMs: number;
  crcPassed: boolean;
  snrEstimate?: number | null;
  packetCount?: number;
  duplicatePacketsDetected?: number;
  clientLocalRefId?: string;
}

export interface DeviceTelemetryData {
  deviceId: string;
  userId: string | null;
  userAgent: string;
  browser: 'Chrome' | 'Safari' | 'Firefox' | 'Edge' | 'Other';
  os: 'Windows' | 'Android' | 'macOS' | 'iOS' | 'Linux' | 'Other';
  isMobile: boolean;
  supportedSampleRates: number[];
  actualSampleRate: number;
  audioWorkletSupported: boolean;
  micPermission: 'granted' | 'denied' | 'prompt';
  maxInputChannels: number;
  highFreqSensitivityScore: number;
  lastActive: number;
  createdAt: number;
}

export interface FeedbackData {
  feedbackId: string;
  userId: string | null;
  rating: number;
  category: 'transmission_quality' | 'bug' | 'feature_request' | 'audio_hardware' | 'other';
  profileUsed: 'reliable' | 'balanced' | 'fast' | 'experimental' | null;
  comment: string;
  deviceDiagnostics: {
    browser: string;
    os: string;
    sampleRate: number;
    highFreqSensitivityScore: number;
  };
  status: 'new' | 'reviewed' | 'resolved';
  createdAt: number;
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

export interface IAuthService {
  currentUser: MockUser | null;
  signInGuest(uid?: string): MockUser;
  signInUser(uid: string, email: string, role?: 'user' | 'admin'): MockUser;
  signInAdmin(uid: string, email?: string): MockUser;
  signOut(): void;
  onAuthStateChanged(callback: (user: MockUser | null) => void): () => void;
}

export interface IDatabaseService {
  getDoc(collection: string, docId: string): Promise<Record<string, any> | null>;
  setDoc(collection: string, docId: string, data: Record<string, any>, merge?: boolean): Promise<void>;
  updateDoc(collection: string, docId: string, data: Record<string, any>): Promise<void>;
  deleteDoc(collection: string, docId: string): Promise<void>;
  getDocs(collection: string, filterFn?: (item: any) => boolean): Promise<Record<string, any>[]>;
  addDoc(collection: string, data: Record<string, any>): Promise<string>;
  validateWrite(collection: string, docId: string, data: Record<string, any>, isCreate?: boolean): ValidationResult;
  validateRead(collection: string, docId: string): ValidationResult;
}

const STORAGE_KEY_PREFIX = 'ultralink_mock_db_';
const AUTH_STORAGE_KEY = 'ultralink_mock_user';

export class MockFirebaseService implements IAuthService, IDatabaseService {
  public currentUser: MockUser | null = null;
  private authListeners: Set<(user: MockUser | null) => void> = new Set();
  
  public collections: {
    profiles: Map<string, Record<string, any>>;
    preferences: Map<string, Record<string, any>>;
    message_history: Map<string, Record<string, any>>;
    devices: Map<string, Record<string, any>>;
    feedback: Map<string, Record<string, any>>;
    [key: string]: Map<string, Record<string, any>>;
  } = {
    profiles: new Map(),
    preferences: new Map(),
    message_history: new Map(),
    devices: new Map(),
    feedback: new Map()
  };

  constructor() {
    this.restoreFromStorage();
    this.seedDefaultTelemetryIfEmpty();
  }

  // --------------------------------------------------------------------------
  // AUTHENTICATION SUBSYSTEM
  // --------------------------------------------------------------------------

  public signInGuest(customUid?: string): MockUser {
    const uid = customUid || `guest_${Math.random().toString(36).substring(2, 9)}`;
    const guestUser: MockUser = {
      uid,
      email: null,
      displayName: `Guest-${uid.substring(uid.length - 4).toUpperCase()}`,
      isAnonymous: true,
      role: 'user',
      createdAt: Date.now()
    };
    this.currentUser = guestUser;
    this.persistAuth();

    // Auto-create default guest profile & preferences
    if (!this.collections.profiles.has(uid)) {
      this.collections.profiles.set(uid, {
        userId: uid,
        displayName: guestUser.displayName,
        email: null,
        photoURL: null,
        isAnonymous: true,
        role: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        settings: { notificationsEnabled: true, analyticsConsent: true, autoSaveHistory: true }
      });
    }

    if (!this.collections.preferences.has(uid)) {
      this.collections.preferences.set(uid, {
        userId: uid,
        defaultProfile: 'balanced',
        theme: 'dark',
        audioPreferences: {
          outputVolume: 0.8,
          carrierFrequency: 17500,
          minFrequency: 17100,
          maxFrequency: 18900,
          enableAutoGainControl: false,
          enableEchoCancellation: false,
          enableNoiseSuppression: false,
          hapticFeedback: true,
          soundConfirmation: true
        },
        updatedAt: Date.now()
      });
    }

    this.notifyAuthListeners();
    this.saveCollectionToStorage('profiles');
    this.saveCollectionToStorage('preferences');
    return this.currentUser;
  }

  public signInUser(uid: string, email: string, role: 'user' | 'admin' = 'user'): MockUser {
    const user: MockUser = {
      uid,
      email,
      displayName: email.split('@')[0],
      isAnonymous: false,
      role,
      createdAt: Date.now()
    };
    this.currentUser = user;
    this.persistAuth();

    if (!this.collections.profiles.has(uid)) {
      this.collections.profiles.set(uid, {
        userId: uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: null,
        isAnonymous: false,
        role,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        settings: { notificationsEnabled: true, analyticsConsent: true, autoSaveHistory: true }
      });
      this.saveCollectionToStorage('profiles');
    }

    this.notifyAuthListeners();
    return this.currentUser;
  }

  public signInAdmin(uid: string, email: string = 'admin@ultralink.internal'): MockUser {
    return this.signInUser(uid, email, 'admin');
  }

  public async signInWithEmail(email: string, password?: string): Promise<MockUser> {
    if (!email || !email.includes('@')) {
      throw new Error('Invalid email format');
    }
    if (password && password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    const uid = `user_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const role: 'user' | 'admin' = email.includes('admin') ? 'admin' : 'user';
    return this.signInUser(uid, email, role);
  }

  public async signUpWithEmail(email: string, password?: string, displayName?: string): Promise<MockUser> {
    const user = await this.signInWithEmail(email, password);
    if (displayName) {
      user.displayName = displayName;
      const profile = this.collections.profiles.get(user.uid);
      if (profile) {
        profile.displayName = displayName;
        profile.updatedAt = Date.now();
        this.saveCollectionToStorage('profiles');
      }
    }
    return user;
  }

  public async signInWithGoogle(): Promise<MockUser> {
    const rand = Math.random().toString(36).substring(2, 7);
    const email = `google.user.${rand}@gmail.com`;
    const uid = `google_${rand}`;
    return this.signInUser(uid, email, 'user');
  }

  public async linkAccount(email: string): Promise<MockUser> {
    if (!this.currentUser) {
      throw new Error('No user currently signed in');
    }
    this.currentUser.email = email;
    this.currentUser.isAnonymous = false;
    const profile = this.collections.profiles.get(this.currentUser.uid);
    if (profile) {
      profile.email = email;
      profile.isAnonymous = false;
      profile.updatedAt = Date.now();
      this.saveCollectionToStorage('profiles');
    }
    this.persistAuth();
    this.notifyAuthListeners();
    return this.currentUser;
  }

  public signOut(): void {
    this.currentUser = null;
    this.persistAuth();
    this.notifyAuthListeners();
  }

  public onAuthStateChanged(callback: (user: MockUser | null) => void): () => void {
    this.authListeners.add(callback);
    callback(this.currentUser);
    return () => {
      this.authListeners.delete(callback);
    };
  }

  private notifyAuthListeners(): void {
    for (const listener of this.authListeners) {
      try {
        listener(this.currentUser);
      } catch (e) {
        console.error('[MockFirebase] Auth listener error:', e);
      }
    }
  }

  // --------------------------------------------------------------------------
  // SECURITY RULES VALIDATION (RBAC & ZERO-PLAINTEXT ENFORCEMENT)
  // --------------------------------------------------------------------------

  public validateWrite(collection: string, docId: string, data: Record<string, any>, isCreate: boolean = true): ValidationResult {
    if (!this.currentUser) {
      return { allowed: false, reason: 'Unauthenticated' };
    }

    // 1. Profiles collection
    if (collection === 'profiles') {
      if (docId !== this.currentUser.uid && this.currentUser.role !== 'admin') {
        return { allowed: false, reason: 'Cross-user write forbidden' };
      }
      if (data.role === 'admin' && this.currentUser.role !== 'admin') {
        return { allowed: false, reason: 'Privilege escalation prevented: cannot assign admin role' };
      }
      const existingProfile = this.collections.profiles.get(docId);
      if (!isCreate && 'createdAt' in data && data.createdAt !== existingProfile?.createdAt) {
        return { allowed: false, reason: 'createdAt is immutable' };
      }
      return { allowed: true };
    }

    // 2. Preferences collection
    if (collection === 'preferences') {
      if (docId !== this.currentUser.uid) {
        return { allowed: false, reason: 'Preferences can only be modified by owner' };
      }
      return { allowed: true };
    }

    // 3. Message history: ZERO PLAINTEXT GUARANTEE
    if (collection === 'message_history') {
      if (data.ownerId !== this.currentUser.uid) {
        return { allowed: false, reason: 'ownerId must match auth.uid' };
      }
      // Strict privacy check: Any plaintext or decrypted payload field is rejected
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
        if (data[field] !== undefined && data[field] !== null) {
          return { allowed: false, reason: 'Architectural privacy violation: zero plaintext allowed in Firestore' };
        }
      }
      return { allowed: true };
    }

    // 4. Devices collection
    if (collection === 'devices') {
      return { allowed: true };
    }

    // 5. Feedback collection
    if (collection === 'feedback') {
      if (!isCreate && this.currentUser.role !== 'admin') {
        return { allowed: false, reason: 'Only admin can update feedback status' };
      }
      return { allowed: true };
    }

    return { allowed: false, reason: 'Default-deny unmatched collection' };
  }

  public validateRead(collection: string, docId: string): ValidationResult {
    if (!this.currentUser) {
      return { allowed: false, reason: 'Unauthenticated' };
    }

    if (collection === 'profiles' || collection === 'preferences') {
      if (docId === this.currentUser.uid || this.currentUser.role === 'admin') {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Owner or admin read only' };
    }

    if (collection === 'message_history') {
      const doc = this.collections.message_history.get(docId);
      if (!doc) return { allowed: true };
      if (doc.ownerId === this.currentUser.uid) return { allowed: true };
      return { allowed: false, reason: 'Private telemetry isolated to owner only' };
    }

    if (collection === 'devices' || collection === 'feedback') {
      return { allowed: true };
    }

    return { allowed: false, reason: 'Default-deny' };
  }

  // --------------------------------------------------------------------------
  // FIRESTORE CRUD OPERATIONS
  // --------------------------------------------------------------------------

  public async getDoc(collection: string, docId: string): Promise<Record<string, any> | null> {
    const colMap = this.getCollectionMap(collection);
    const data = colMap.get(docId);
    return data ? { ...data } : null;
  }

  public async setDoc(collection: string, docId: string, data: Record<string, any>, merge: boolean = false): Promise<void> {
    // Privacy check
    if (collection === 'message_history') {
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
        if (data[field] !== undefined && data[field] !== null) {
          throw new Error('Privacy violation: Zero plaintext allowed in Firestore message_history');
        }
      }
    }
    const colMap = this.getCollectionMap(collection);
    const existing = colMap.get(docId) || {};
    if (collection === 'profiles' && existing && 'createdAt' in data && data.createdAt !== existing.createdAt) {
      throw new Error('createdAt is immutable');
    }
    const finalData = merge ? { ...existing, ...data } : { ...data };
    colMap.set(docId, finalData);
    this.saveCollectionToStorage(collection);
  }

  public async updateDoc(collection: string, docId: string, data: Record<string, any>): Promise<void> {
    const colMap = this.getCollectionMap(collection);
    const existing = colMap.get(docId);
    if (!existing) {
      throw new Error(`Document ${docId} does not exist in ${collection}`);
    }
    if (collection === 'message_history') {
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
        if (data[field] !== undefined && data[field] !== null) {
          throw new Error('Privacy violation: Zero plaintext allowed in Firestore message_history');
        }
      }
    }
    if (collection === 'profiles') {
      if ('createdAt' in data && data.createdAt !== existing.createdAt) {
        throw new Error('createdAt is immutable');
      }
    }
    colMap.set(docId, { ...existing, ...data });
    this.saveCollectionToStorage(collection);
  }

  public async deleteDoc(collection: string, docId: string): Promise<void> {
    const colMap = this.getCollectionMap(collection);
    colMap.delete(docId);
    this.saveCollectionToStorage(collection);
  }

  public async getDocs(collection: string, filterFn?: (item: any) => boolean): Promise<Record<string, any>[]> {
    const colMap = this.getCollectionMap(collection);
    let items = Array.from(colMap.values());
    if (filterFn) {
      items = items.filter(filterFn);
    }
    return items.map(i => ({ ...i }));
  }

  public async addDoc(collection: string, data: Record<string, any>): Promise<string> {
    const docId = `${collection}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    await this.setDoc(collection, docId, data);
    return docId;
  }

  private getCollectionMap(collection: string): Map<string, Record<string, any>> {
    if (!this.collections[collection]) {
      this.collections[collection] = new Map();
    }
    return this.collections[collection];
  }

  // --------------------------------------------------------------------------
  // PERSISTENCE & LOCALSTORAGE RESTORATION
  // --------------------------------------------------------------------------

  private saveCollectionToStorage(collection: string): void {
    if (typeof window === 'undefined') return;
    try {
      const colMap = this.collections[collection];
      if (!colMap) return;
      const arr = Array.from(colMap.entries());
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${collection}`, JSON.stringify(arr));
    } catch {
      // Ignore quota errors in private browsing
    }
  }

  private persistAuth(): void {
    if (typeof window === 'undefined') return;
    try {
      if (this.currentUser) {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(this.currentUser));
      } else {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch {}
  }

  private restoreFromStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      // Restore auth
      const savedUser = localStorage.getItem(AUTH_STORAGE_KEY);
      if (savedUser) {
        this.currentUser = JSON.parse(savedUser);
      }

      // Restore collections
      const knownCollections = ['profiles', 'preferences', 'message_history', 'devices', 'feedback'];
      for (const col of knownCollections) {
        const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${col}`);
        if (raw) {
          const entries: [string, any][] = JSON.parse(raw);
          const map = new Map<string, any>();
          for (const [k, v] of entries) {
            map.set(k, v);
          }
          this.collections[col] = map;
        }
      }
    } catch {
      // Fallback cleanly to in-memory state
    }
  }

  private seedDefaultTelemetryIfEmpty(): void {
    // Only seed if message_history is completely empty, ensuring rich telemetry for demo
    if (this.collections.message_history.size === 0) {
      const seedMessages: MessageHistoryTelemetryData[] = [
        {
          messageId: 'msg_seed_01',
          ownerId: 'guest_demo',
          direction: 'transmitted',
          timestamp: Date.now() - 3600000 * 3,
          payloadLength: 48,
          status: 'success',
          profileUsed: 'balanced',
          sampleRate: 48000,
          frequencyRange: '17.1kHz - 18.3kHz',
          durationMs: 850,
          crcPassed: true,
          snrEstimate: 24.5,
          packetCount: 1,
          duplicatePacketsDetected: 0
        },
        {
          messageId: 'msg_seed_02',
          ownerId: 'guest_demo',
          direction: 'received',
          timestamp: Date.now() - 3600000 * 2,
          payloadLength: 120,
          status: 'success',
          profileUsed: 'reliable',
          sampleRate: 44100,
          frequencyRange: '17.1kHz - 18.0kHz',
          durationMs: 1420,
          crcPassed: true,
          snrEstimate: 19.8,
          packetCount: 2,
          duplicatePacketsDetected: 0
        },
        {
          messageId: 'msg_seed_03',
          ownerId: 'user_42',
          direction: 'transmitted',
          timestamp: Date.now() - 3600000 * 1,
          payloadLength: 32,
          status: 'success',
          profileUsed: 'fast',
          sampleRate: 48000,
          frequencyRange: '17.0kHz - 18.5kHz',
          durationMs: 420,
          crcPassed: true,
          snrEstimate: 28.1,
          packetCount: 1,
          duplicatePacketsDetected: 0
        },
        {
          messageId: 'msg_seed_04',
          ownerId: 'user_42',
          direction: 'received',
          timestamp: Date.now() - 1800000,
          payloadLength: 95,
          status: 'crc_mismatch',
          profileUsed: 'experimental',
          sampleRate: 48000,
          frequencyRange: '17.0kHz - 18.9kHz',
          durationMs: 610,
          crcPassed: false,
          snrEstimate: 8.2,
          packetCount: 2,
          duplicatePacketsDetected: 1
        },
        {
          messageId: 'msg_seed_05',
          ownerId: 'guest_demo',
          direction: 'transmitted',
          timestamp: Date.now() - 600000,
          payloadLength: 64,
          status: 'success',
          profileUsed: 'balanced',
          sampleRate: 48000,
          frequencyRange: '17.1kHz - 18.3kHz',
          durationMs: 910,
          crcPassed: true,
          snrEstimate: 22.0,
          packetCount: 1,
          duplicatePacketsDetected: 0
        }
      ];

      for (const m of seedMessages) {
        this.collections.message_history.set(m.messageId, m);
      }
    }

    if (this.collections.devices.size === 0) {
      const seedDevices: DeviceTelemetryData[] = [
        {
          deviceId: 'dev_win_01',
          userId: 'user_42',
          userAgent: 'Chrome on Windows 11',
          browser: 'Chrome',
          os: 'Windows',
          isMobile: false,
          supportedSampleRates: [44100, 48000],
          actualSampleRate: 48000,
          audioWorkletSupported: true,
          micPermission: 'granted',
          maxInputChannels: 2,
          highFreqSensitivityScore: 92,
          lastActive: Date.now() - 300000,
          createdAt: Date.now() - 86400000
        },
        {
          deviceId: 'dev_mac_02',
          userId: 'guest_demo',
          userAgent: 'Safari on macOS',
          browser: 'Safari',
          os: 'macOS',
          isMobile: false,
          supportedSampleRates: [44100, 48000],
          actualSampleRate: 44100,
          audioWorkletSupported: true,
          micPermission: 'granted',
          maxInputChannels: 1,
          highFreqSensitivityScore: 88,
          lastActive: Date.now() - 600000,
          createdAt: Date.now() - 172800000
        },
        {
          deviceId: 'dev_android_03',
          userId: null,
          userAgent: 'Chrome on Android',
          browser: 'Chrome',
          os: 'Android',
          isMobile: true,
          supportedSampleRates: [44100, 48000],
          actualSampleRate: 48000,
          audioWorkletSupported: true,
          micPermission: 'granted',
          maxInputChannels: 1,
          highFreqSensitivityScore: 95,
          lastActive: Date.now() - 1200000,
          createdAt: Date.now() - 259200000
        }
      ];

      for (const d of seedDevices) {
        this.collections.devices.set(d.deviceId, d);
      }
    }

    if (this.collections.feedback.size === 0) {
      const seedFeedback: FeedbackData[] = [
        {
          feedbackId: 'fb_01',
          userId: 'user_42',
          rating: 5,
          category: 'transmission_quality',
          profileUsed: 'balanced',
          comment: 'Flawless near-ultrasonic transmission across the room! Impressive zero-lag decoding.',
          deviceDiagnostics: {
            browser: 'Chrome',
            os: 'Windows',
            sampleRate: 48000,
            highFreqSensitivityScore: 92
          },
          status: 'reviewed',
          createdAt: Date.now() - 7200000
        },
        {
          feedbackId: 'fb_02',
          userId: 'guest_demo',
          rating: 4,
          category: 'audio_hardware',
          profileUsed: 'fast',
          comment: 'Works great on laptop speakers. High-freq sensitivity scored 88%.',
          deviceDiagnostics: {
            browser: 'Safari',
            os: 'macOS',
            sampleRate: 44100,
            highFreqSensitivityScore: 88
          },
          status: 'new',
          createdAt: Date.now() - 14400000
        }
      ];

      for (const f of seedFeedback) {
        this.collections.feedback.set(f.feedbackId, f);
      }
    }
  }
}

// Singleton instance for browser app runtime
let mockServiceSingleton: MockFirebaseService | null = null;

export function getMockFirebaseService(): MockFirebaseService {
  if (!mockServiceSingleton) {
    mockServiceSingleton = new MockFirebaseService();
  }
  return mockServiceSingleton;
}

export const mockService = getMockFirebaseService();

// Export class alias MockFirebaseHarness matching E2E test suites
export { MockFirebaseService as MockFirebaseHarness };
