# Project: UltraLink

## Architecture
UltraLink is a device-to-device acoustic communication Progressive Web App (PWA) operating over near-ultrasonic frequencies (17.0–19.0 kHz) using the Web Audio API. It functions 100% offline for core transmission and file decoding, complemented by Firebase Auth and Cloud Firestore for preferences, device diagnostics, and privacy-preserving analytics.

```
+-----------------------------------------------------------------------------------+
|                                  UltraLink PWA                                    |
|                                                                                   |
|  +-----------------------------------+  +--------------------------------------+  |
|  |           UI Layer (Next.js)      |  |        ThreeUI Background Visual     |  |
|  | - /transmit      - /receive-file  |  | - PredictiveArcCanvas (void-field)   |  |
|  | - /live-listen   - /history       |  |   Dynamic SSR-safe WebGL background  |  |
|  | - /diagnostics   - /admin         |  +--------------------------------------+  |
|  +-----------------------------------+                                            |
|                  |                                          |                     |
|                  v                                          v                     |
|  +-----------------------------------+  +--------------------------------------+  |
|  |       Core Audio DSP Engine       |  |          Data & Auth Services        |  |
|  | - CP-FSK / MFSK (17.0 - 19.0 kHz) |  | - Firebase Auth (Email/Google/Guest) |  |
|  | - 4 Profiles (Reliable, Balanced, |  | - Cloud Firestore (5 collections)    |  |
|  |   Fast, Experimental)             |  | - MockFirebaseService (Offline demo) |  |
|  | - Binary Packet Framing & CRC32   |  | - Local IndexedDB Private Vault      |  |
|  | - AudioWorklet Live Receiver      |  |   (100% client-side message text)    |  |
|  | - Pure TS 16-bit PCM WAV Codec    |  | - Security Rules (RBAC isolation)    |  |
|  +-----------------------------------+  +--------------------------------------+  |
|                  |                                          |                     |
|                  v                                          v                     |
|  +-----------------------------------------------------------------------------+  |
|  |                        PWA Offline Service Worker                           |  |
|  | - Precaches app shell, assets, and AudioWorklet processor script            |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Near-Ultrasonic Modulation | CP-FSK / MFSK tone synthesis in 17.0–19.0 kHz range with Tukey cosine windowing | M1 | ORIGINAL_REQUEST §R1 |
| 2 | 4 Configurable Profiles | Reliable, Balanced, Fast, Experimental profiles varying baud rate and spacing | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Binary Packet Framing | Preamble chirp, Barker-13 sync, 8-byte CRC8 header, chunking, CRC32 trailer, postamble | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Unicode & Emoji Chunking | UTF-8 byte stream chunking with out-of-order reassembly and duplicate suppression | M1 | ORIGINAL_REQUEST §R1, §R4 |
| 5 | AudioWorklet Live Demodulator | Dedicated audio-thread processor with Goertzel filter bank, dynamic SNR, state machine | M1 | ORIGINAL_REQUEST §R1 |
| 6 | Dual Sample Rate Invariance | Mathematical tone generation & detection support for both 44.1 kHz and 48.0 kHz | M1 | ORIGINAL_REQUEST §Acceptance |
| 7 | Pure TS RIFF WAV Codec | 16-bit PCM WAV encoder & decoder for offline file export and upload without mic | M1 | ORIGINAL_REQUEST §Acceptance |
| 8 | Acoustic Hardening | Doppler / drift AFC with parabolic interpolation, guard intervals, noise floor tracking | M1 | ORIGINAL_REQUEST §R4 |
| 9 | DSP Protocol Unit Tests | Test suite verifying chunking, reassembly, noise tolerance, frequency offset, CRC | M1 | ORIGINAL_REQUEST §R4 |
| 10 | Next.js App Shell & Layout | Responsive cybernetic dark UI layout with zero horizontal overflow on mobile/desktop | M2 | ORIGINAL_REQUEST §R2 |
| 11 | ThreeUI PredictiveArcCanvas | Exact PredictiveArcCanvas component (variant void-field) with SSR-safe dynamic wrapper | M2 | ORIGINAL_REQUEST §R2 |
| 12 | Transmit Page | Message composer, profile picker, live frequency visualizer, playback, WAV download | M2 | ORIGINAL_REQUEST §R2 |
| 13 | Receive File Page | Offline audio file drag-and-drop, decoding progress, message display, CRC badge | M2 | ORIGINAL_REQUEST §R2 |
| 14 | Live Listen Page | Microphone stream toggle, AudioWorklet hookup, 60fps spectrogram canvas, live feed | M2 | ORIGINAL_REQUEST §R2 |
| 15 | History Page | Local IndexedDB message vault, filter by sent/received, search, JSON/WAV export | M2 | ORIGINAL_REQUEST §R2 |
| 16 | Device Diagnostics Page | Mic permission check, sample rate detection, latency gauge, 17-19kHz acoustic test | M2 | ORIGINAL_REQUEST §R2 |
| 17 | PWA Manifest & Service Worker | Manifest metadata and sw.js precaching AudioWorklet and assets for 100% offline use | M2 | ORIGINAL_REQUEST §R2 |
| 18 | Dual-Mode Firebase SDK | Firebase Client SDK with automatic transparent MockFirebaseService for offline demo | M3 | ORIGINAL_REQUEST §R3 |
| 19 | Tri-Modal Authentication | Email/Password, Google OAuth, and Instant Guest/Anonymous mode with account linking | M3 | ORIGINAL_REQUEST §R3 |
| 20 | 5 Firestore Collections | schemas for profiles, preferences, message_history, devices, feedback | M3 | ORIGINAL_REQUEST §R3 |
| 21 | Architectural Privacy Guarantee | Zero plaintext messages stored in Cloud Firestore; local IndexedDB storage only | M3 | ORIGINAL_REQUEST §R3 |
| 22 | Role-Based Admin Dashboard | /admin route displaying aggregate throughput, profile stats, hardware stats, feedback | M3 | ORIGINAL_REQUEST §R3 |
| 23 | Firestore Security Rules | Strict RBAC security rules preventing cross-user data access, authored by firestore-rules-author | M3 | ORIGINAL_REQUEST §R3 |
| 24 | Firebase App Hosting Config | apphosting.yaml and clean build verification (npm run build succeeds without errors) | M3 | ORIGINAL_REQUEST §R3 |
| 25 | E2E Test Suite (Tiers 1-4) | Comprehensive opaque-box test runner covering features, boundaries, pairs, and workloads | E2E Track | ORIGINAL_REQUEST §R4 |
| 26 | Final Integration & Hardening | 100% E2E test pass + adversarial coverage hardening (Tier 5) + Forensic Audit | M4 | ORIGINAL_REQUEST §Acceptance |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Suite | Requirements-driven opaque-box test infra & cases (Tiers 1-4), outputs TEST_READY.md | none | DONE |
| M1 | Core Audio DSP Engine | Modulation, packet framing, CRC32, AudioWorklet, WAV codec, unit tests | none | DONE |
| M2 | Frontend PWA & ThreeUI | Next.js app shell, 5 pages, PredictiveArcCanvas (void-field), PWA service worker | M1 (interfaces) | DONE |
| M3 | Backend Storage & Rules | Firebase Auth (Guest/Email/Google), 5 collections, privacy vault, Admin dashboard, firestore.rules, apphosting.yaml | none | DONE |
| M4 | Final Integration & Gate | Full system integration, 100% E2E test pass, adversarial hardening (Tier 5), forensic audit | M1, M2, M3, E2E | IN_PROGRESS |

## Interface Contracts

### 1. DSP Engine ↔ Frontend UI (`src/lib/dsp`)
```typescript
export interface ModulationProfile {
  id: 'reliable' | 'balanced' | 'fast' | 'experimental';
  name: string;
  scheme: '4-fsk' | '8-fsk' | '16-fsk' | 'dual-8fsk';
  baseFreq: number; // e.g., 17000
  freqSpacing: number; // e.g., 150
  symbolDurationMs: number; // e.g., 40
  bitsPerSymbol: number; // e.g., 3
  bandwidthHz: number;
  nominalBitrateBps: number;
}

export interface PacketHeader {
  version: number;
  profileId: number;
  messageId: number;
  chunkIndex: number;
  totalChunks: number;
  payloadLength: number;
}

export interface DecodedMessage {
  messageId: number;
  text: string;
  timestamp: number;
  profileId: string;
  crcPassed: boolean;
  snrDb: number;
  sampleRate: number;
  durationMs: number;
}

export interface DspEncoder {
  encodeTextToAudioBuffer(text: string, profile: ModulationProfile, sampleRate: number): Float32Array;
  encodeTextToWav(text: string, profile: ModulationProfile, sampleRate: number): Uint8Array;
}

export interface DspDecoder {
  decodeWavBuffer(wavBytes: Uint8Array): Promise<DecodedMessage>;
  decodeAudioSamples(samples: Float32Array, sampleRate: number): DecodedMessage[];
}
```

### 2. AudioWorklet ↔ Live Listen Component
- Worklet Path: `/worklets/ultralink-decoder-worklet.js`
- PostMessage from Worklet:
  - `{ type: 'SPECTRUM', bins: Float32Array }` (for 60fps spectrogram display)
  - `{ type: 'SYNC_DETECTED', confidence: number }`
  - `{ type: 'PACKET_DECODED', packet: DecodedMessage }`
  - `{ type: 'CRC_ERROR', messageId: number, expected: number, actual: number }`
- PostMessage to Worklet:
  - `{ type: 'SET_PROFILE', profile: ModulationProfile }`
  - `{ type: 'SET_SAMPLE_RATE', sampleRate: number }`
  - `{ type: 'RESET' }`

### 3. Data & Storage Service ↔ Frontend UI (`src/lib/firebase`)
```typescript
export interface UserProfile {
  uid: string;
  email?: string;
  displayName: string;
  isAnonymous: boolean;
  role: 'user' | 'admin';
  createdAt: number;
}

export interface MessageTelemetry {
  id: string;
  ownerId: string;
  direction: 'sent' | 'received';
  timestamp: number;
  payloadLength: number;
  profileUsed: string;
  status: 'delivered' | 'decoded' | 'crc_failed';
  crcPassed: boolean;
  durationMs: number;
  sampleRate: number;
  snrDb?: number;
}

export interface LocalMessageRecord extends MessageTelemetry {
  text: string; // Stored exclusively in client IndexedDB
}
```

## Code Layout
```
ultralink/
├── app/
│   ├── layout.tsx
│   ├── page.tsx (redirects to /transmit or hero)
│   ├── transmit/page.tsx
│   ├── receive-file/page.tsx
│   ├── live-listen/page.tsx
│   ├── history/page.tsx
│   ├── diagnostics/page.tsx
│   ├── admin/page.tsx
│   └── manifest.ts
├── components/
│   ├── threeui/
│   │   ├── PredictiveArcCanvas.tsx (variant void-field)
│   │   └── PredictiveArcCanvasWrapper.tsx (dynamic SSR: false)
│   ├── layout/
│   │   ├── Navigation.tsx
│   │   └── Header.tsx
│   ├── audio/
│   │   ├── SpectrogramCanvas.tsx
│   │   ├── AudioVisualizer.tsx
│   │   └── ProfileSelector.tsx
│   └── ui/ (buttons, inputs, cards, badges)
├── lib/
│   ├── dsp/
│   │   ├── profiles.ts
│   │   ├── framing.ts
│   │   ├── crc.ts
│   │   ├── modulation.ts
│   │   ├── demodulation.ts
│   │   ├── goertzel.ts
│   │   ├── wav.ts
│   │   └── audio-worklet-bridge.ts
│   ├── firebase/
│   │   ├── config.ts
│   │   ├── auth.ts
│   │   ├── firestore.ts
│   │   └── mock-service.ts
│   └── storage/
│       └── indexeddb.ts (local private message vault)
├── public/
│   ├── sw.js (service worker with AudioWorklet precache)
│   └── worklets/
│       └── ultralink-decoder-worklet.js
├── tests/
│   ├── unit/ (DSP framing, modulation, crc, wav)
│   └── e2e/ (test runner and tiers 1-4 suites)
├── firestore.rules
├── apphosting.yaml
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.mjs
```
