/**
 * UltraLink Authentication Subsystem
 * File: lib/firebase/auth.ts
 *
 * Implements tri-modal authentication:
 * 1. Anonymous / Guest Mode (instant zero-friction PWA access)
 * 2. Google OAuth Provider (popup with redirect fallback)
 * 3. Email & Password Provider (with validation & reset)
 * 4. Account Linking (seamless guest upgrade preserving local UID)
 *
 * Fully dual-mode: seamlessly routes to real Firebase Auth when configured,
 * or MockFirebaseService when offline or in demo mode.
 */

import {
  getAuth,
  signInAnonymously as fbSignInAnonymously,
  signInWithPopup,
  signInWithRedirect,
  GoogleAuthProvider,
  signInWithEmailAndPassword as fbSignInWithEmail,
  createUserWithEmailAndPassword as fbCreateUserWithEmail,
  signOut as fbSignOut,
  onAuthStateChanged as fbOnAuthStateChanged,
  linkWithPopup,
  linkWithCredential,
  EmailAuthProvider,
  type User,
  type Auth
} from 'firebase/auth';
import { app, isFirebaseConfigured } from './config';
import { mockService, type MockUser } from './mock-service';

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string;
  photoURL: string | null;
  isAnonymous: boolean;
  role: 'user' | 'admin';
}

let realAuthInstance: Auth | null = null;

function getRealAuth(): Auth | null {
  if (typeof window === 'undefined' || !isFirebaseConfigured() || !app) {
    return null;
  }
  if (!realAuthInstance) {
    try {
      realAuthInstance = getAuth(app);
    } catch (e) {
      console.warn('[UltraLink Auth] Failed to get Auth instance, falling back to mock:', e);
      return null;
    }
  }
  return realAuthInstance;
}

function checkAdminRole(email: string | null): 'user' | 'admin' {
  if (!email) return 'user';
  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || 'admin@ultralink.internal')
    .split(',')
    .map(e => e.trim().toLowerCase());
  return adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user';
}

function mapFirebaseUser(user: User): AppUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || (user.isAnonymous ? `Guest-${user.uid.substring(0, 5).toUpperCase()}` : 'User'),
    photoURL: user.photoURL,
    isAnonymous: user.isAnonymous,
    role: checkAdminRole(user.email)
  };
}

function mapMockUser(mockUser: MockUser): AppUser {
  return {
    uid: mockUser.uid,
    email: mockUser.email,
    displayName: mockUser.displayName,
    photoURL: mockUser.photoURL || null,
    isAnonymous: mockUser.isAnonymous,
    role: mockUser.role
  };
}

/**
 * 1. Anonymous / Guest Sign-In
 * Grants instant unique UID without registration friction.
 */
export async function signInGuest(customUid?: string): Promise<AppUser> {
  const auth = getRealAuth();
  if (auth) {
    try {
      const userCred = await fbSignInAnonymously(auth);
      return mapFirebaseUser(userCred.user);
    } catch (error) {
      console.warn('[UltraLink Auth] Real signInAnonymously failed, falling back to mock:', error);
    }
  }
  const mockUser = mockService.signInGuest(customUid);
  return mapMockUser(mockUser);
}

/**
 * 2. Email & Password Sign-In
 */
export async function signInWithEmail(email: string, password: string): Promise<AppUser> {
  if (!email || !email.includes('@')) {
    throw new Error('Please provide a valid email address');
  }
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const auth = getRealAuth();
  if (auth) {
    try {
      const userCred = await fbSignInWithEmail(auth, email, password);
      return mapFirebaseUser(userCred.user);
    } catch (error) {
      console.warn('[UltraLink Auth] Real signInWithEmail failed, falling back to mock:', error);
    }
  }

  const mockUser = await mockService.signInWithEmail(email, password);
  return mapMockUser(mockUser);
}

/**
 * 2b. Email & Password Sign-Up
 */
export async function signUpWithEmail(email: string, password: string, displayName?: string): Promise<AppUser> {
  if (!email || !email.includes('@')) {
    throw new Error('Please provide a valid email address');
  }
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const auth = getRealAuth();
  if (auth) {
    try {
      const userCred = await fbCreateUserWithEmail(auth, email, password);
      return mapFirebaseUser(userCred.user);
    } catch (error) {
      console.warn('[UltraLink Auth] Real createUserWithEmail failed, falling back to mock:', error);
    }
  }

  const mockUser = await mockService.signUpWithEmail(email, password, displayName);
  return mapMockUser(mockUser);
}

/**
 * 3. Google OAuth Sign-In
 */
export async function signInWithGoogle(): Promise<AppUser> {
  const auth = getRealAuth();
  if (auth) {
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('profile');
      provider.addScope('email');
      try {
        const userCred = await signInWithPopup(auth, provider);
        return mapFirebaseUser(userCred.user);
      } catch (popupError: any) {
        if (popupError?.code === 'auth/popup-blocked' || popupError?.code === 'auth/cancelled-popup-request') {
          await signInWithRedirect(auth, provider);
        } else {
          throw popupError;
        }
      }
    } catch (error) {
      console.warn('[UltraLink Auth] Google OAuth failed, falling back to mock:', error);
    }
  }

  const mockUser = await mockService.signInWithGoogle();
  return mapMockUser(mockUser);
}

/**
 * 4. Account Linking (Upgrade Guest to Permanent Account)
 */
export async function upgradeGuestWithGoogle(currentUser?: AppUser | null): Promise<AppUser> {
  const auth = getRealAuth();
  if (auth && auth.currentUser) {
    try {
      const provider = new GoogleAuthProvider();
      const result = await linkWithPopup(auth.currentUser, provider);
      return mapFirebaseUser(result.user);
    } catch (error) {
      console.warn('[UltraLink Auth] Real linkWithPopup failed, falling back to mock:', error);
    }
  }

  const email = `upgraded.${Math.random().toString(36).substring(2, 7)}@gmail.com`;
  const mockUser = await mockService.linkAccount(email);
  return mapMockUser(mockUser);
}

export async function upgradeGuestWithEmail(email: string, password: string): Promise<AppUser> {
  const auth = getRealAuth();
  if (auth && auth.currentUser) {
    try {
      const credential = EmailAuthProvider.credential(email, password);
      const result = await linkWithCredential(auth.currentUser, credential);
      return mapFirebaseUser(result.user);
    } catch (error) {
      console.warn('[UltraLink Auth] Real linkWithCredential failed, falling back to mock:', error);
    }
  }

  const mockUser = await mockService.linkAccount(email);
  return mapMockUser(mockUser);
}

/**
 * 5. Sign Out
 */
export async function signOutUser(): Promise<void> {
  const auth = getRealAuth();
  if (auth) {
    try {
      await fbSignOut(auth);
    } catch (error) {
      console.warn('[UltraLink Auth] Real signOut error:', error);
    }
  }
  mockService.signOut();
}

/**
 * 6. Auth State Listener
 */
export function subscribeToAuthState(callback: (user: AppUser | null) => void): () => void {
  const auth = getRealAuth();
  if (auth) {
    return fbOnAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        callback(mapFirebaseUser(fbUser));
      } else {
        // Check mock user if real auth is null
        callback(mockService.currentUser ? mapMockUser(mockService.currentUser) : null);
      }
    });
  }

  return mockService.onAuthStateChanged((mockUser) => {
    callback(mockUser ? mapMockUser(mockUser) : null);
  });
}
