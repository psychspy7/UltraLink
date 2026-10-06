# UltraLink: End-to-End Test Infrastructure Specification (TEST_INFRA.md)

**Document**: `TEST_INFRA.md`  
**Author**: E2E Test Writer  
**Status**: Active / Approved  
**Target Project**: UltraLink Acoustic Data-Over-Sound PWA  
**Workspace**: `C:\Users\HP\.gemini\antigravity\scratch\ultralink`  

---

## 1. Test Philosophy & Engineering Principles

UltraLink is a mission-critical, near-ultrasonic device-to-device communication Progressive Web App (PWA). Because acoustic physical channels are inherently prone to environmental reverberation, ambient noise, Doppler shift, transducer rolloff, and asynchronous browser event loops, testing cannot be treated as an afterthought.

### 1.1 Opaque-Box, Requirement-Driven Testing
- **Black-Box Invariance**: Tests interact strictly with public API surfaces, binary protocols, Web Audio contracts, DOM state representations, and storage boundaries. Internal private helper implementations may refactor without breaking tests.
- **Specification-Derived Oracles**: Expected outputs are derived mathematically from authoritative standards:
  - IEEE 802.3 Standard CRC32 polynomial (`0xEDB88320`) and CRC8-CCITT (`0x07`).
  - RFC 3629 UTF-8 specification for multi-byte Unicode and astral-plane emoji codepoints.
  - RIFF WAV 16-bit PCM specification (44-byte canonical header, little-endian 2's complement).
  - Goertzel filter response equations for exact continuous frequency evaluations.
  - Continuous Phase Frequency Shift Keying (CP-FSK) phase continuity criteria ($\Delta \phi = 0$).
  - Cloud Firestore Security Rules role-based access control predicates.

### 1.2 Five-Tier Test Hierarchy

```
+-----------------------------------------------------------------------------+
| Tier 5: Adversarial & Chaos Hardening (Milestone 4 - Post-Implementation)   |
|         Bit corruption, multipath echo, packet dropping, fuzzing            |
+-----------------------------------------------------------------------------+
| Tier 4: Real-World Application Workflows (>=5 Multi-Step End-to-End Flows)  |
|         Transmitter -> Air Channel -> Receiver, Offline WAV, Auth & RBAC     |
+-----------------------------------------------------------------------------+
| Tier 3: Cross-Feature Combinations (Pairwise Inter-Module Interactions)     |
|         Profile switching x Sample rates, IndexedDB vault x PWA offline     |
+-----------------------------------------------------------------------------+
| Tier 2: Boundary & Corner Cases (>=5 per feature for all 26 features)       |
|         Max chunk lengths, 0-byte inputs, AFC limiters, edge frequencies    |
+-----------------------------------------------------------------------------+
| Tier 1: Feature Coverage (>=5 per feature for all 26 features)              |
|         Happy path verification for all 26 project inventory features       |
+-----------------------------------------------------------------------------+
```

---

## 2. Feature Inventory Mapping (All 26 Features)

Each of the 26 features identified in `PROJECT.md` is mapped to its specification source, interface contract, and designated Tier 1 & Tier 2 test suites:

| # | Feature Name | Description | Source | Tier 1 Coverage (>=5) | Tier 2 Boundary (>=5) |
|---|---|---|---|---|---|
| **F01** | Near-Ultrasonic Modulation | CP-FSK / MFSK tone synthesis (17.0–19.0 kHz) with Tukey cosine windowing | ORIGINAL_REQUEST §R1 | `T1_F01_01` to `T1_F01_05` | `T2_F01_01` to `T2_F01_05` |
| **F02** | 4 Configurable Profiles | Reliable (4-FSK), Balanced (8-FSK), Fast (16-FSK), Experimental (Dual-Tone) | ORIGINAL_REQUEST §R1 | `T1_F02_01` to `T1_F02_05` | `T2_F02_01` to `T2_F02_05` |
| **F03** | Binary Packet Framing | Chirp preamble, Barker-13 sync, 8B header, CRC8 header checksum, CRC32 trailer | ORIGINAL_REQUEST §R1 | `T1_F03_01` to `T1_F03_05` | `T2_F03_01` to `T2_F03_05` |
| **F04** | Unicode & Emoji Chunking | UTF-8 multi-chunk partitioning, sequence numbering, out-of-order reassembly | ORIGINAL_REQUEST §R1, §R4 | `T1_F04_01` to `T1_F04_05` | `T2_F04_01` to `T2_F04_05` |
| **F05** | AudioWorklet Live Demodulator | Dedicated audio-thread Goertzel filter bank, dynamic SNR, state machine | ORIGINAL_REQUEST §R1 | `T1_F05_01` to `T1_F05_05` | `T2_F05_01` to `T2_F05_05` |
| **F06** | Dual Sample Rate Invariance | Invariant continuous-Hz tone generation/detection across 44.1 kHz and 48.0 kHz | ORIGINAL_REQUEST §Acceptance | `T1_F06_01` to `T1_F06_05` | `T2_F06_01` to `T2_F06_05` |
| **F07** | Pure TS RIFF WAV Codec | 16-bit PCM WAV encoder & decoder for offline file export and upload without mic | ORIGINAL_REQUEST §Acceptance | `T1_F07_01` to `T1_F07_05` | `T2_F07_01` to `T2_F07_05` |
| **F08** | Acoustic Hardening | Doppler / drift AFC with parabolic interpolation, guard intervals, noise floor tracking | ORIGINAL_REQUEST §R4 | `T1_F08_01` to `T1_F08_05` | `T2_F08_01` to `T2_F08_05` |
| **F09** | DSP Protocol Unit Tests | Protocol verification verifying chunking, reassembly, noise tolerance, CRC | ORIGINAL_REQUEST §R4 | `T1_F09_01` to `T1_F09_05` | `T2_F09_01` to `T2_F09_05` |
| **F10** | Next.js App Shell & Layout | Cybernetic dark UI layout with zero horizontal overflow on mobile/desktop | ORIGINAL_REQUEST §R2 | `T1_F10_01` to `T1_F10_05` | `T2_F10_01` to `T2_F10_05` |
| **F11** | ThreeUI PredictiveArcCanvas | Exact PredictiveArcCanvas component (variant void-field) with SSR-safe wrapper | ORIGINAL_REQUEST §R2 | `T1_F11_01` to `T1_F11_05` | `T2_F11_01` to `T2_F11_05` |
| **F12** | Transmit Page | Message composer, profile picker, live frequency visualizer, playback, WAV download | ORIGINAL_REQUEST §R2 | `T1_F12_01` to `T1_F12_05` | `T2_F12_01` to `T2_F12_05` |
| **F13** | Receive File Page | Offline audio file drag-and-drop, decoding progress, message display, CRC badge | ORIGINAL_REQUEST §R2 | `T1_F13_01` to `T1_F13_05` | `T2_F13_01` to `T2_F13_05` |
| **F14** | Live Listen Page | Mic toggle, AudioWorklet hookup, 60fps spectrogram canvas, live feed | ORIGINAL_REQUEST §R2 | `T1_F14_01` to `T1_F14_05` | `T2_F14_01` to `T2_F14_05` |
| **F15** | History Page | Local IndexedDB message vault, filter by sent/received, search, JSON/WAV export | ORIGINAL_REQUEST §R2 | `T1_F15_01` to `T1_F15_05` | `T2_F15_01` to `T2_F15_05` |
| **F16** | Device Diagnostics Page | Mic permission check, sample rate detection, latency gauge, 17-19kHz acoustic test | ORIGINAL_REQUEST §R2 | `T1_F16_01` to `T1_F16_05` | `T2_F16_01` to `T2_F16_05` |
| **F17** | PWA Manifest & Service Worker | Manifest metadata and sw.js precaching AudioWorklet and assets for 100% offline use | ORIGINAL_REQUEST §R2 | `T1_F17_01` to `T1_F17_05` | `T2_F17_01` to `T2_F17_05` |
| **F18** | Dual-Mode Firebase SDK | Firebase Client SDK with automatic transparent MockFirebaseService for offline demo | ORIGINAL_REQUEST §R3 | `T1_F18_01` to `T1_F18_05` | `T2_F18_01` to `T2_F18_05` |
| **F19** | Tri-Modal Authentication | Email/Password, Google OAuth, and Instant Guest/Anonymous mode with account linking | ORIGINAL_REQUEST §R3 | `T1_F19_01` to `T1_F19_05` | `T2_F19_01` to `T2_F19_05` |
| **F20** | 5 Firestore Collections | Schemas for profiles, preferences, message_history, devices, feedback | ORIGINAL_REQUEST §R3 | `T1_F20_01` to `T1_F20_05` | `T2_F20_01` to `T2_F20_05` |
| **F21** | Architectural Privacy Guarantee | Zero plaintext messages stored in Cloud Firestore; local IndexedDB storage only | ORIGINAL_REQUEST §R3 | `T1_F21_01` to `T1_F21_05` | `T2_F21_01` to `T2_F21_05` |
| **F22** | Role-Based Admin Dashboard | /admin route displaying aggregate throughput, profile stats, hardware stats, feedback | ORIGINAL_REQUEST §R3 | `T1_F22_01` to `T1_F22_05` | `T2_F22_01` to `T2_F22_05` |
| **F23** | Firestore Security Rules | Strict RBAC security rules preventing cross-user data access and escalation | ORIGINAL_REQUEST §R3 | `T1_F23_01` to `T1_F23_05` | `T2_F23_01` to `T2_F23_05` |
| **F24** | Firebase App Hosting Config | apphosting.yaml and clean build verification (npm run build succeeds without errors) | ORIGINAL_REQUEST §R3 | `T1_F24_01` to `T1_F24_05` | `T2_F24_01` to `T2_F24_05` |
| **F25** | E2E Test Suite (Tiers 1-4) | Comprehensive opaque-box test runner covering features, boundaries, pairs, and workloads | ORIGINAL_REQUEST §R4 | `T1_F25_01` to `T1_F25_05` | `T2_F25_01` to `T2_F25_05` |
| **F26** | Final Integration & Hardening | 100% E2E test pass + adversarial coverage hardening (Tier 5) + Forensic Audit | ORIGINAL_REQUEST §Acceptance | `T1_F26_01` to `T1_F26_05` | `T2_F26_01` to `T2_F26_05` |

---

## 3. Test Architecture & Runner Design

### 3.1 Self-Contained Zero-Dependency Execution
To eliminate environment flakiness and dependency version incompatibilities across CI and local environments, the test runner is implemented in pure, self-contained Node.js (CommonJS / ES Module compatible). It executes directly via standard `node`:

```bash
node tests/e2e/runner.js
```

### 3.2 Command-Line Interface Flags
The runner supports granular command-line arguments:
- `--tier=1` : Run Tier 1 Feature Coverage suite only.
- `--tier=2` : Run Tier 2 Boundary & Corner Cases suite only.
- `--tier=3` : Run Tier 3 Cross-Feature Combinations suite only.
- `--tier=4` : Run Tier 4 Real-World Application Scenarios suite only.
- `--feature=F01` : Filter tests to a specific feature ID (e.g. F01 through F26).
- `--verbose` : Enable detailed step-by-step logging.
- `--json` : Output machine-readable JSON results.
- `--tap` : Output Test Anything Protocol (TAP) format.

### 3.3 Test Harness Architecture (`tests/e2e/harness.js`)
The test runner incorporates a modular simulation and oracle harness:
1. **Acoustic Channel Simulator**:
   - Models physical speaker-to-air-to-microphone propagation.
   - Injects configurable Additive White Gaussian Noise (AWGN), multipath delay reflections ($5-25\text{ ms}$), and Doppler frequency shifts ($\pm 50\text{ Hz}$).
2. **Audio Environment Mock**:
   - Emulates `AudioContext`, `Float32Array` sample pipelines, `AudioBufferSourceNode`, and `BiquadFilterNode`.
   - Emulates `AudioWorkletNode` and `AudioWorkletGlobalScope` message port serialization.
3. **Storage & Firebase Mock Harness**:
   - IndexedDB in-memory mock for the private message vault (`ultralink_local_vault`).
   - Mock Firebase Auth and Firestore with security rule evaluation assertions.
4. **Authoritative Math Oracles**:
   - Reference IEEE 802.3 CRC32 calculator and CRC8-CCITT calculator.
   - Reference Goertzel algorithm and Tukey window generator.
   - Reference RIFF WAV 16-bit header and payload encoder/decoder.

---

## 4. Tier 4: Real-World Application Workflows (Detailed Breakdown)

### Scenario 1: Near-Ultrasonic Live Acoustic Transmission & Reception
- **Actors**: Device A (Transmitter, 48.0 kHz) and Device B (Receiver, 44.1 kHz).
- **Workflow**:
  1. User on Device A enters `"UltraLink Acoustic Uplink Active 🚀"` on `/transmit` and selects `Balanced` profile.
  2. Device A partitions the text into framed packets, calculates CRC8 and CRC32, synthesizes CP-FSK audio in 17.1–18.3 kHz, and plays through speaker.
  3. Device B on `/live-listen` captures the acoustic wave through microphone.
  4. Worklet detects preamble chirp, locks symbol clock, runs Goertzel filter bank, validates CRC8 header, and reassembles payload.
  5. Device B verifies CRC32 checksum, posts packet to UI, displays green verification badge, and saves plaintext exclusively to local IndexedDB.
  6. Device B syncs non-plaintext telemetry (`payloadLength: 35`, `crcPassed: true`) to Cloud Firestore.

### Scenario 2: Microphone-Free Offline File Export & File Upload Decoding
- **Actors**: User sharing sensitive data without microphone access.
- **Workflow**:
  1. User navigates to `/transmit` with network disconnected.
  2. User inputs a 120-byte multilingual text (ASCII + Japanese + Emoji).
  3. User selects `Fast` profile (16-FSK, 1 nibble/symbol) and clicks `"Download WAV File"`.
  4. System encodes pure 16-bit PCM RIFF WAV in memory and triggers browser download.
  5. User transfers WAV file to another machine (or navigates to `/receive-file`).
  6. User drops the WAV file onto `/receive-file`.
  7. Client-side decoder extracts samples, parses packets, verifies all chunk CRCs, and renders original text in <200ms without network access.

### Scenario 3: Harsh Acoustic Environment with Multi-Chunk Retransmission
- **Actors**: Two devices operating in a noisy classroom with room reverberation.
- **Workflow**:
  1. User selects `Reliable` profile (4-FSK, 250 Hz spacing, 65ms symbol duration).
  2. Input message exceeds single-chunk limit (requires 3 chunks).
  3. Transmitter broadcasts chunk 0, chunk 1, chunk 2, and redundantly repeats chunk 1.
  4. Receiver receives chunk 1, then chunk 0, then duplicate chunk 1, then chunk 2 out of order.
  5. Deduplication engine drops the duplicate chunk 1.
  6. Reassembly engine orders chunks `0 -> 1 -> 2`, verifies collective CRC, and outputs pristine text.

### Scenario 4: Tri-Modal Authentication, Account Linking & RBAC Isolation
- **Actors**: Anonymous Guest user upgrading to authenticated user, attempting admin access.
- **Workflow**:
  1. User opens UltraLink in standalone PWA mode as an anonymous Guest (`auth.currentUser.isAnonymous === true`).
  2. User sends 3 messages; local vault stores text, Firestore stores telemetry under guest UID.
  3. User triggers account linking with Google / Email credentials.
  4. User UID is preserved; all existing telemetry and local vault messages remain accessible.
  5. User attempts to navigate to `/admin` or write a document with `role: 'admin'`.
  6. Route guard redirects to `/`, and Firestore Security Rules reject write with permission-denied.
  7. User with verified bootstrap admin credentials logs in; accesses `/admin`, views aggregate profile usage and hardware statistics, with zero access to private message content.

### Scenario 5: Hardware Audio Diagnostics & Ultrasonic Transducer Audit
- **Actors**: User calibrating device audio before important transmission.
- **Workflow**:
  1. User navigates to `/diagnostics`.
  2. Diagnostics engine queries AudioContext, detecting hardware sample rate ($44,100\text{ Hz}$ or $48,000\text{ Hz}$) and base buffer latency.
  3. User initiates Ultrasonic Speaker Calibration Test: system generates ramped test tones at $17.5\text{ kHz}$, $18.0\text{ kHz}$, and $18.5\text{ kHz}$.
  4. User runs Microphone High-Frequency Response Audit: system computes spectral power ratio in $17.0-19.0\text{ kHz}$ band vs ambient floor.
  5. System outputs high-frequency sensitivity score (e.g., $94/100$) and recommends optimal profile (`Balanced` or `Reliable`).
  6. PWA offline readiness checklist verifies Service Worker and AudioWorklet caching.

---

## 5. Coverage Thresholds & Success Criteria

To achieve certification for Phase 1 and milestone graduation, the following quantitative thresholds are enforced:

1. **Feature Coverage**: 100% of all 26 features must have at least 5 passing Tier 1 test cases ($26 \times 5 \ge 130$ tests).
2. **Boundary & Corner Cases**: 100% of all 26 features must have at least 5 passing Tier 2 boundary test cases ($26 \times 5 \ge 130$ tests).
3. **Cross-Feature Pairwise Coverage**: At least 20 distinct pairwise cross-feature interaction test cases in Tier 3.
4. **Real-World Scenarios**: At least 5 end-to-end multi-step workflow test cases in Tier 4.
5. **Total Test Suite Volume**: $\ge 300$ deterministic, verifiable test cases.
6. **Pass Rate**: 100% pass rate ($0$ failures, $0$ errors, $0$ unhandled rejections).
7. **Clean CLI Output**: Must run via `node tests/e2e/runner.js` returning exit code `0` on success and non-zero on failure.
