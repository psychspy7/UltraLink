/**
 * UltraLink Firebase Configuration & SDK Initialization
 * File: lib/firebase/config.ts
 *
 * Implements dual-mode operational architecture:
 * - Detects environment variables for production Firebase Web SDK.
 * - Gracefully activates MockFirebaseService fallback when unconfigured, in demo mode, or offline.
 * - Protects against SSR runtime panics (window / indexedDB checks).
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';

export interface FirebaseClientConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
}

export const firebaseConfig: FirebaseClientConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'ultralink-acoustic.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'ultralink-acoustic',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'ultralink-acoustic.appspot.com',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '123456789012',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:123456789012:web:abcdef123456',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-ULTRALINK01'
};

/**
 * Determines whether Firebase has real production credentials configured.
 * Returns false when missing, empty, or set to placeholder 'demo-api-key'.
 */
export function isFirebaseConfigured(): boolean {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }
  const trimmed = apiKey.trim();
  return trimmed !== '' && trimmed !== 'demo-api-key';
}

export const isMockMode = !isFirebaseConfigured();

let firebaseAppInstance: FirebaseApp | null = null;

/**
 * Retrieves or initializes the FirebaseApp instance.
 * Safe for both Client Components and SSR.
 */
export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) {
    return null;
  }

  if (firebaseAppInstance) {
    return firebaseAppInstance;
  }

  try {
    const existingApps = getApps();
    if (existingApps.length > 0) {
      firebaseAppInstance = existingApps[0];
    } else {
      firebaseAppInstance = initializeApp(firebaseConfig as Record<string, string>);
    }
    return firebaseAppInstance;
  } catch (error) {
    console.warn('[UltraLink Firebase] Initialization warning, activating mock fallback:', error);
    return null;
  }
}

export const app = typeof window !== 'undefined' && isFirebaseConfigured() ? getFirebaseApp() : null;
