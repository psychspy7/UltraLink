# Original User Request

## Initial Request — 2026-10-06T17:32:41Z

Build UltraLink, a device-to-device communication PWA that converts text into near-ultrasonic sound and decodes it back to text using the Web Audio API, functioning completely offline for core transmission.

Working directory: C:\Users\HP\.gemini\antigravity\scratch\ultralink
Integrity mode: demo

## Requirements

### R1. Core Audio DSP (Encoder & Decoder)
- Implement robust binary encoding, checksumming (CRC16/32), and signal modulation (BFSK/MFSK in 17-19kHz range) for transmission. Standard open-source DSP/FFT libraries are allowed.
- Implement an AudioWorklet-based live decoder that analyzes mic input incrementally, detects preamble, synchronizes, and reassembles packets.
- Provide 4 configurable profiles (Reliable, Balanced, Fast, Experimental).

### R2. Web Application & Interface
- Build a responsive frontend with Transmit, Receive File, Live Listen, History, and Device Diagnostics pages.
- Embed the exact ThreeUI `PredictiveArcCanvas` (variant `void-field`) component precisely from the provided source.
- Configure as a Progressive Web App (PWA) with offline capabilities for the core encoder/decoder.

### R3. Backend & Storage
- Setup Authentication (Email, Google, Guest mode) and database using Firebase Auth and Cloud Firestore.
- Set up database collections (`profiles`, `preferences`, `message_history`, `devices`, `feedback`) with strict Firestore Security Rules.
- Build a role-based admin analytics dashboard to track usage metrics without exposing private message content.
- Prepare the project for deployment on Firebase App Hosting.

### R4. Testing & Infrastructure
- Implement protocol tests verifying ASCII/Unicode chunking, reassembly, noise tolerance, frequency offset, and CRC failures.
- Ensure the project builds cleanly for deployment.

## Acceptance Criteria

### Audio Transmission
- [ ] Automated tests pass for full round-trip encoding and decoding (ASCII, Unicode, emoji) with 44.1kHz and 48kHz sample rates.
- [ ] Automated tests correctly detect CRC failures and duplicate packets.
- [ ] A generated WAV/MP3 file can be downloaded and correctly decoded when uploaded back to the system.

### PWA & Interface
- [ ] The app renders responsively on mobile and desktop without layout overflows.
- [ ] The `PredictiveArcCanvas` successfully loads and renders as a background in the web application using the exact requested variant (`void-field`).
- [ ] Core features (transmit, offline file decode) continue to function offline after initial load.

### Backend & Deployment
- [ ] Users can sign in (or use guest mode) and Firestore Security Rules successfully prevent users from reading or writing other users' private data.
- [ ] Running `npm run build` succeeds without type or lint errors, producing an optimized Next.js build.
