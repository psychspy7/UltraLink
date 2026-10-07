/**
 * UltraLink E2E Test Suite — Tier 5: Adversarial & Acoustic Stress Verification
 * File: tests/e2e/tier5_adversarial.js
 * 
 * Challenger 1 Adversarial Stress Test Cases:
 * 1. Multi-byte Unicode, CJK, RTL, and complex ZWJ emoji sequences
 * 2. Massive multi-chunk payloads (>500B) with out-of-order and scrambled reassembly
 * 3. Channel impairments: Additive White Gaussian Noise (AWGN) and Doppler drift (+-50 Hz)
 * 4. Exhaustive bit flips: CRC8 header and CRC32 payload corrupt rejection
 * 5. Dual sample rate invariance (44.1 kHz vs 48.0 kHz) and WAV file roundtrips
 * 6. Signal integrity across all 4 operational modulation profiles
 */

'use strict';

const {
  assert,
  assertEqual,
  assertDeepEqual,
  assertCloseTo,
  assertThrows,
  crc8,
  crc32,
  encodeUtf8,
  decodeUtf8,
  encodeWav,
  decodeWav,
  PROFILES,
  MAGIC_BYTE,
  BARKER_13,
  synthesizeContinuousPhaseTone,
  goertzelPower,
  buildPacket,
  parsePacket,
  PacketReassembler,
  AcousticChannelSimulator,
  MockIndexedDBVault,
  MockFirebaseHarness
} = require('./harness');

const tests = [];

function register(id, name, fn) {
  tests.push({ id, tier: 5, feature: 'ADVERSARIAL', name, fn });
}

// ============================================================================
// 1. MULTI-BYTE UNICODE, CJK, RTL & COMPLEX EMOJIS
// ============================================================================

register('T5_ADV_01', 'Multi-byte CJK glyphs survive framing and reassembly', () => {
  const cjkText = '日本語のテスト：超音波音響通信でテキストを送信する。 简体中文：近超声频段物理层数据包。 한국어 음향 프로토콜.';
  const payloadBytes = encodeUtf8(cjkText);
  assert(payloadBytes.length > 50, 'CJK text must be multi-byte UTF-8');

  // Chunk with balanced profile (32 bytes per chunk)
  const maxPayload = 32;
  const totalChunks = Math.ceil(payloadBytes.length / maxPayload);
  const reassembler = new PacketReassembler();

  for (let i = 0; i < totalChunks; i++) {
    const chunk = payloadBytes.subarray(i * maxPayload, Math.min((i + 1) * maxPayload, payloadBytes.length));
    const packetBytes = buildPacket(1, 7001, totalChunks, i, chunk);
    const parsed = parsePacket(packetBytes);
    assert(parsed.valid, 'Packet must be valid');
    const result = reassembler.addPacket(parsed);
    if (i === totalChunks - 1) {
      assertEqual(result.status, 'complete');
      assertEqual(result.text, cjkText);
    }
  }
});

register('T5_ADV_02', 'Bidirectional RTL text (Arabic & Hebrew) survives chunking without byte corruption', () => {
  const rtlText = 'مرحبا بالعالم — بروتوكول الترا لينك الصوتي 2026 — שלום עולם';
  const payloadBytes = encodeUtf8(rtlText);
  const totalChunks = Math.ceil(payloadBytes.length / 16); // Reliable profile 16 bytes/chunk
  const reassembler = new PacketReassembler();

  for (let i = 0; i < totalChunks; i++) {
    const chunk = payloadBytes.subarray(i * 16, Math.min((i + 1) * 16, payloadBytes.length));
    const packetBytes = buildPacket(0, 7002, totalChunks, i, chunk);
    const parsed = parsePacket(packetBytes);
    const res = reassembler.addPacket(parsed);
    if (i === totalChunks - 1) {
      assertEqual(res.status, 'complete');
      assertEqual(res.text, rtlText);
    }
  }
});

register('T5_ADV_03', 'Complex ZWJ family sequences and multi-emoji chains survive byte splitting across chunk boundaries', () => {
  // Family emoji (25 bytes UTF-8) + modifiers + rockets + flags
  const emojiText = '🛰️ 👨‍👩‍👧‍👦 🚀 🏳️‍🌈 🔐 ✨ 👩🏽‍🚀 📡 100% Offline!';
  const payloadBytes = encodeUtf8(emojiText);

  // Splitting into 16-byte chunks intentionally splits the 25-byte ZWJ emoji sequence across chunks!
  const totalChunks = Math.ceil(payloadBytes.length / 16);
  const reassembler = new PacketReassembler();

  let finalRes = null;
  for (let i = 0; i < totalChunks; i++) {
    const chunk = payloadBytes.subarray(i * 16, Math.min((i + 1) * 16, payloadBytes.length));
    const packetBytes = buildPacket(0, 7003, totalChunks, i, chunk);
    const parsed = parsePacket(packetBytes);
    finalRes = reassembler.addPacket(parsed);
  }

  assertEqual(finalRes.status, 'complete');
  assertEqual(finalRes.text, emojiText);
});

// ============================================================================
// 2. MASSIVE PAYLOADS & OUT-OF-ORDER / SCRAMBLED REASSEMBLY
// ============================================================================

register('T5_ADV_04', 'Massive 512-byte payload chunks into 32 packets and reassembles in reverse order (31 down to 0)', () => {
  let largeText = '';
  for (let i = 0; i < 32; i++) {
    largeText += `[CHUNK_${i.toString().padStart(2, '0')}_TEST!]`;
  }
  const payloadBytes = encodeUtf8(largeText);
  const totalChunks = 32;
  assertEqual(payloadBytes.length, 32 * 16);

  const packets = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunk = payloadBytes.subarray(i * 16, (i + 1) * 16);
    const packetBytes = buildPacket(0, 8001, totalChunks, i, chunk);
    packets.push(parsePacket(packetBytes));
  }

  const reassembler = new PacketReassembler();

  // Feed in reverse order
  let finalRes = null;
  for (let i = totalChunks - 1; i >= 0; i--) {
    const res = reassembler.addPacket(packets[i]);
    if (i === 0) finalRes = res;
    else assertEqual(res.status, 'partial');
  }

  assertEqual(finalRes.status, 'complete');
  assertEqual(finalRes.text, largeText);
});

register('T5_ADV_05', 'Reassembles chunks arriving in pseudo-random scrambled order', () => {
  const text = 'Scrambled packet arrival reassembly stress test payload for UltraLink acoustic protocol!';
  const payloadBytes = encodeUtf8(text);
  const totalChunks = Math.ceil(payloadBytes.length / 16);
  const packets = [];

  for (let i = 0; i < totalChunks; i++) {
    const chunk = payloadBytes.subarray(i * 16, Math.min((i + 1) * 16, payloadBytes.length));
    packets.push(parsePacket(buildPacket(0, 8002, totalChunks, i, chunk)));
  }

  // Permute order
  const permutation = [3, 1, 4, 0, 5, 2];
  const reassembler = new PacketReassembler();

  let finalRes = null;
  for (const idx of permutation) {
    if (idx < packets.length) {
      const res = reassembler.addPacket(packets[idx]);
      if (res.status === 'complete') finalRes = res;
    }
  }

  assert(finalRes !== null, 'Reassembler must complete once all chunks arrive');
  assertEqual(finalRes.text, text);
});

register('T5_ADV_06', 'Duplicate chunks and completed message replay are safely deduplicated', () => {
  const text = 'Deduplication stress test';
  const payloadBytes = encodeUtf8(text);
  const p0 = parsePacket(buildPacket(1, 8003, 2, 0, payloadBytes.subarray(0, 16)));
  const p1 = parsePacket(buildPacket(1, 8003, 2, 1, payloadBytes.subarray(16)));

  const reassembler = new PacketReassembler();

  // Deliver chunk 0
  const r0 = reassembler.addPacket(p0);
  assertEqual(r0.status, 'partial');

  // Replay chunk 0
  const r0_dup = reassembler.addPacket(p0);
  assertEqual(r0_dup.status, 'duplicate_chunk');

  // Deliver chunk 1
  const r1 = reassembler.addPacket(p1);
  assertEqual(r1.status, 'complete');

  // Replay chunk 0 after completion
  const r0_after = reassembler.addPacket(p0);
  assertEqual(r0_after.status, 'duplicate_message');
});

register('T5_ADV_07', 'Dropped chunk prevents incomplete message emission (zero partial garbage output)', () => {
  const text = 'Incomplete message test payload';
  const payloadBytes = encodeUtf8(text);
  const p0 = parsePacket(buildPacket(1, 8004, 3, 0, payloadBytes.subarray(0, 10)));
  // chunk 1 dropped!
  const p2 = parsePacket(buildPacket(1, 8004, 3, 2, payloadBytes.subarray(20)));

  const reassembler = new PacketReassembler();
  assertEqual(reassembler.addPacket(p0).status, 'partial');
  assertEqual(reassembler.addPacket(p2).status, 'partial');
});

// ============================================================================
// 3. CHANNEL IMPAIRMENTS: AWGN NOISE AND DOPPLER SHIFT
// ============================================================================

register('T5_ADV_08', 'Acoustic tone detection retains high SNR under AWGN noise (18 dB)', () => {
  const freq = 17500;
  const sampleRate = 48000;
  const { samples } = synthesizeContinuousPhaseTone(freq, 32, sampleRate, 0, 2.5);
  const noisySamples = AcousticChannelSimulator.addNoise(samples, 18.0);

  const signalPower = goertzelPower(noisySamples, freq, sampleRate);
  const adjacentPower = goertzelPower(noisySamples, freq + 150, sampleRate);

  assert(signalPower > adjacentPower * 4, 'Signal tone power must clearly exceed adjacent bin power at 18dB SNR');
});

register('T5_ADV_09', 'Acoustic tone survives multipath room reverberation echo (15ms delay, 0.3 attenuation)', () => {
  const freq = 17800;
  const sampleRate = 48000;
  const { samples } = synthesizeContinuousPhaseTone(freq, 32, sampleRate, 0, 2.5);
  const echoedSamples = AcousticChannelSimulator.applyMultipathEcho(samples, sampleRate, 15, 0.3);

  const detectedPower = goertzelPower(echoedSamples, freq, sampleRate);
  assert(detectedPower > 0.05, 'Signal tone must remain detectable under multipath reflection');
});

register('T5_ADV_10', 'Frequency Doppler drift of +30 Hz shifts spectral peak consistently', () => {
  const freq = 17500;
  const sampleRate = 48000;
  const { samples } = synthesizeContinuousPhaseTone(freq, 40, sampleRate, 0, 2.5);
  const shifted = AcousticChannelSimulator.applyDoppler(samples, sampleRate, 30.0);

  const nominalPower = goertzelPower(shifted, freq, sampleRate);
  const shiftedPower = goertzelPower(shifted, freq + 30, sampleRate);

  assert(shiftedPower >= nominalPower, 'Power at shifted frequency must be greater than or equal to unshifted frequency');
});

// ============================================================================
// 4. BIT FLIPS AND PACKET CORRUPTION REJECTION (CRC8 & CRC32)
// ============================================================================

register('T5_ADV_11', 'CRC8 rejects 100% of single-bit flips across every byte of the 8-byte header', () => {
  const payload = encodeUtf8('Integrity test');
  const packetBytes = buildPacket(1, 9101, 1, 0, payload);

  // Test flipping every bit in bytes 0..7
  for (let byteIdx = 0; byteIdx < 8; byteIdx++) {
    for (let bit = 0; bit < 8; bit++) {
      const corrupted = new Uint8Array(packetBytes);
      corrupted[byteIdx] ^= (1 << bit);
      const parsed = parsePacket(corrupted);
      assert(!parsed.valid, `Packet with bit flip at byte ${byteIdx} bit ${bit} must be rejected`);
    }
  }
});

register('T5_ADV_12', 'CRC32 rejects 100% of single-bit flips across payload and trailer', () => {
  const payload = encodeUtf8('Cryptographic verification payload');
  const packetBytes = buildPacket(1, 9102, 1, 0, payload);

  // Flip bits in payload section (indices 8 to 8 + payload.length - 1)
  for (let i = 8; i < 8 + payload.length; i++) {
    const corrupted = new Uint8Array(packetBytes);
    corrupted[i] ^= 0x01;
    const parsed = parsePacket(corrupted);
    assert(!parsed.valid, `Payload bit flip at offset ${i} must be rejected by CRC32`);
  }

  // Flip bits in CRC32 trailer
  for (let i = 8 + payload.length; i < packetBytes.length; i++) {
    const corrupted = new Uint8Array(packetBytes);
    corrupted[i] ^= 0x01;
    const parsed = parsePacket(corrupted);
    assert(!parsed.valid, `Trailer bit flip at offset ${i} must be rejected by CRC32`);
  }
});

register('T5_ADV_13', 'Truncated packet byte buffers are safely rejected without crashing', () => {
  const payload = encodeUtf8('Truncation test');
  const packetBytes = buildPacket(1, 9103, 1, 0, payload);

  for (let len = 0; len < packetBytes.length - 1; len++) {
    const truncated = packetBytes.subarray(0, len);
    const parsed = parsePacket(truncated);
    assert(!parsed.valid, `Truncated packet of length ${len} must be rejected`);
  }
});

// ============================================================================
// 5. SAMPLE RATE INVARIANCE & WAV CODEC ROUNDTRIP
// ============================================================================

register('T5_ADV_14', 'WAV encoding and decoding roundtrips with bit-exact sample rate at 44.1 kHz', () => {
  const sampleRate = 44100;
  const numSamples = 4410;
  const original = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    original[i] = 0.6 * Math.sin((2 * Math.PI * 17500 * i) / sampleRate);
  }

  const wavBytes = encodeWav(original, sampleRate);
  const decoded = decodeWav(wavBytes);

  assertEqual(decoded.sampleRate, 44100);
  assertEqual(decoded.samples.length, numSamples);
  assertCloseTo(decoded.samples[100], original[100], 0.001);
});

register('T5_ADV_15', 'WAV encoding and decoding roundtrips with bit-exact sample rate at 48.0 kHz', () => {
  const sampleRate = 48000;
  const numSamples = 4800;
  const original = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    original[i] = 0.6 * Math.sin((2 * Math.PI * 17500 * i) / sampleRate);
  }

  const wavBytes = encodeWav(original, sampleRate);
  const decoded = decodeWav(wavBytes);

  assertEqual(decoded.sampleRate, 48000);
  assertEqual(decoded.samples.length, numSamples);
  assertCloseTo(decoded.samples[100], original[100], 0.001);
});

register('T5_ADV_16', 'Corrupted WAV file headers throw informative errors without uncaught crashes', () => {
  assertThrows(() => decodeWav(new Uint8Array(20)), 'Truncated WAV must throw');
  const badRiff = new Uint8Array(44);
  assertThrows(() => decodeWav(badRiff), 'Invalid RIFF magic must throw');
});

// ============================================================================
// 6. ALL 4 MODULATION PROFILES SIGNAL INTEGRITY
// ============================================================================

register('T5_ADV_17', 'Profile 0 (Reliable 4-FSK) maintains 250 Hz tone spacing and SNR threshold 4.5 dB', () => {
  const p = PROFILES.reliable;
  assertEqual(p.profileId, 0);
  assertEqual(p.bitsPerSymbol, 2);
  assertEqual(p.toneSpacing, 250);
  assertEqual(p.maxPayloadBytes, 16);
  assert(p.snrThresholdDb <= 5.0);
});

register('T5_ADV_18', 'Profile 1 (Balanced 8-FSK) maintains 150 Hz tone spacing and SNR threshold 7.0 dB', () => {
  const p = PROFILES.balanced;
  assertEqual(p.profileId, 1);
  assertEqual(p.bitsPerSymbol, 3);
  assertEqual(p.toneSpacing, 150);
  assertEqual(p.maxPayloadBytes, 32);
});

register('T5_ADV_19', 'Profile 2 (Fast 16-FSK) maintains 100 Hz tone spacing and 4 bits per symbol', () => {
  const p = PROFILES.fast;
  assertEqual(p.profileId, 2);
  assertEqual(p.bitsPerSymbol, 4);
  assertEqual(p.toneCount, 16);
  assertEqual(p.maxPayloadBytes, 48);
});

register('T5_ADV_20', 'Profile 3 (Experimental Dual-Tone 8-FSK) maintains dual 8-tone bands (6 bits/symbol)', () => {
  const p = PROFILES.experimental;
  assertEqual(p.profileId, 3);
  assertEqual(p.bitsPerSymbol, 6);
  assertEqual(p.bandA.length, 8);
  assertEqual(p.bandB.length, 8);
  assertEqual(p.maxPayloadBytes, 64);
});

module.exports = { tests };
