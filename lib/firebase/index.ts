/**
 * UltraLink Firebase Module Index
 * File: lib/firebase/index.ts
 *
 * Central export hub for:
 * - Client SDK configuration & dual-mode detection
 * - Tri-modal Authentication
 * - Cloud Firestore 5-collection data access
 * - Transparent offline MockFirebaseService
 */

export * from './config';
export * from './auth';
export * from './firestore';
export * from './mock-service';

// Convenient type aliases matching survey_backend and PROJECT.md specifications
export type {
  UserProfileData as UserProfile,
  UserPreferencesData as UserPreferences,
  MessageHistoryTelemetryData as MessageTelemetry,
  DeviceTelemetryData as DeviceRecord,
  FeedbackData as FeedbackSubmission
} from './mock-service';
