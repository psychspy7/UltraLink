/**
 * UltraLink E2E Test Simulation Harness & Authoritative Oracles
 * File: tests/e2e/harness.js
 * 
 * Provides:
 * - Authoritative mathematical oracles (CRC32, CRC8, CP-FSK, Goertzel, RIFF WAV)
 * - Acoustic physical channel simulation (AWGN noise, multipath echo, Doppler shift)
 * - Web Audio API & AudioWorklet simulation
 * - Storage (IndexedDB) & Firebase (Auth/Firestore/Rules) simulation
 * - Assertions and test runner utilities
 */

'use strict';

// ============================================================================
// 1. ASSERTION UTILITIES
// ============================================================================

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new AssertionError(message);
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    const detail = `Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`;
    throw new AssertionError(message ? `${message} (${detail})` : detail);
  }
}

function assertDeepEqual(actual, expected, message = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    const detail = `Expected: ${expectedStr}, Actual: ${actualStr}`;
    throw new AssertionError(message ? `${message} (${detail})` : detail);
  }
}

function assertCloseTo(actual, expected, delta = 1e-4, message = '') {
  if (Math.abs(actual - expected) > delta) {
    const detail = `Expected ${actual} to be close to ${expected} within +/-${delta}`;
    throw new AssertionError(message ? `${message} (${detail})` : detail);
  }
}

function assertThrows(fn, message = 'Expected function to throw') {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
  }
  if (!threw) {
    throw new AssertionError(message);
  }
}

// ============================================================================
// 2. AUTHORITATIVE MATHEMATICAL & PROTOCOL ORACLES
// ============================================================================

// Standard IEEE 802.3 CRC32 Table
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// CRC8-CCITT Table (Polynomial 0x07)
const CRC8_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let curr = i;
  for (let j = 0; j < 8; j++) {
    curr = (curr & 0x80) ? ((curr << 1) ^ 0x07) : (curr << 1);
  }
  CRC8_TABLE[i] = curr & 0xFF;
}

function crc8(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let crc = 0x00;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC8_TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return crc & 0xFF;
}

// UTF-8 Helpers
function encodeUtf8(str) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const utf8 = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) utf8.push(charcode);
    else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      // surrogate pair
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }
  return new Uint8Array(utf8);
}

function decodeUtf8(bytes) {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  let str = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i++];
    if (b1 < 0x80) {
      str += String.fromCharCode(b1);
    } else if ((b1 >> 5) === 0x06) {
      const b2 = bytes[i++];
      str += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
    } else if ((b1 >> 4) === 0x0e) {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      str += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
    } else if ((b1 >> 3) === 0x1e) {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      const b4 = bytes[i++];
      let cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
      cp -= 0x10000;
      str += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return str;
}

// RIFF WAV 16-bit PCM Codec Oracle
function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF Chunk
  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46); // 'RIFF'
  view.setUint32(4, 36 + samples.length * 2, true);
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45); // 'WAVE'

  // fmt sub-chunk
  view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20); // 'fmt '
  view.setUint32(16, 16, true);           // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);            // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true);            // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true);   // SampleRate
  view.setUint32(28, sampleRate * 2, true);// ByteRate (SampleRate * 1 * 2)
  view.setUint16(32, 2, true);            // BlockAlign (1 * 2)
  view.setUint16(34, 16, true);           // BitsPerSample (16-bit)

  // data sub-chunk
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61); // 'data'
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const int16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function decodeWav(wavBytes) {
  if (wavBytes.length < 44) {
    throw new Error('Invalid WAV file: buffer too short');
  }
  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  
  // Verify RIFF and WAVE
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Invalid WAV magic headers');
  }

  const format = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  if (format !== 1) throw new Error('Unsupported audio format: expected PCM');
  if (bitsPerSample !== 16) throw new Error('Unsupported bit depth: expected 16-bit');

  // Locate data chunk
  let pos = 12;
  let dataOffset = 0;
  let dataSize = 0;
  while (pos < wavBytes.length - 8) {
    const chunkId = String.fromCharCode(view.getUint8(pos), view.getUint8(pos+1), view.getUint8(pos+2), view.getUint8(pos+3));
    const chunkSize = view.getUint32(pos + 4, true);
    if (chunkId === 'data') {
      dataOffset = pos + 8;
      dataSize = chunkSize;
      break;
    }
    pos += 8 + chunkSize;
  }

  if (dataOffset === 0) {
    dataOffset = 44;
    dataSize = wavBytes.length - 44;
  }

  const sampleCount = Math.floor(dataSize / (2 * channels));
  const samples = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const rawInt16 = view.getInt16(dataOffset + i * 2 * channels, true);
    samples[i] = rawInt16 < 0 ? rawInt16 / 0x8000 : rawInt16 / 0x7FFF;
  }

  return { samples, sampleRate, channels, durationSec: sampleCount / sampleRate };
}

// Profiles Specification
const PROFILES = {
  reliable: {
    id: 'reliable',
    profileId: 0,
    name: 'Reliable (4-FSK)',
    modulation: '4FSK',
    baseFrequency: 17300,
    toneSpacing: 250,
    toneCount: 4,
    symbolDurationMs: 50,
    guardDurationMs: 15,
    rampDurationMs: 3.5,
    bitsPerSymbol: 2,
    maxPayloadBytes: 16,
    snrThresholdDb: 4.5,
    freqs: [17300, 17550, 17800, 18050]
  },
  balanced: {
    id: 'balanced',
    profileId: 1,
    name: 'Balanced (8-FSK)',
    modulation: '8FSK',
    baseFrequency: 17200,
    toneSpacing: 150,
    toneCount: 8,
    symbolDurationMs: 32,
    guardDurationMs: 8,
    rampDurationMs: 2.5,
    bitsPerSymbol: 3,
    maxPayloadBytes: 32,
    snrThresholdDb: 7.0,
    freqs: [17200, 17350, 17500, 17650, 17800, 17950, 18100, 18250]
  },
  fast: {
    id: 'fast',
    profileId: 2,
    name: 'Fast (16-FSK)',
    modulation: '16FSK',
    baseFrequency: 17100,
    toneSpacing: 100,
    toneCount: 16,
    symbolDurationMs: 20,
    guardDurationMs: 5,
    rampDurationMs: 2.0,
    bitsPerSymbol: 4,
    maxPayloadBytes: 48,
    snrThresholdDb: 9.0,
    freqs: [
      17100, 17200, 17300, 17400, 17500, 17600, 17700, 17800,
      17900, 18000, 18100, 18200, 18300, 18400, 18500, 18600
    ]
  },
  experimental: {
    id: 'experimental',
    profileId: 3,
    name: 'Experimental (Dual-Tone MFSK)',
    modulation: 'DUAL_8FSK',
    baseFrequency: 17100,
    toneSpacing: 100,
    toneCount: 16,
    symbolDurationMs: 20,
    guardDurationMs: 5,
    rampDurationMs: 2.0,
    bitsPerSymbol: 6,
    maxPayloadBytes: 64,
    snrThresholdDb: 10.0,
    bandA: [17100, 17200, 17300, 17400, 17500, 17600, 17700, 17800],
    bandB: [18100, 18200, 18300, 18400, 18500, 18600, 18700, 18800]
  }
};

// Continuous Phase Tone Synthesizer with Tukey Window
function synthesizeContinuousPhaseTone(freq, durationMs, sampleRate, startPhase = 0, rampMs = 2.5) {
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const rampSamples = Math.floor((rampMs / 1000) * sampleRate);
  const samples = new Float32Array(numSamples);
  let phase = startPhase;
  const phaseInc = (2 * Math.PI * freq) / sampleRate;

  for (let i = 0; i < numSamples; i++) {
    // Tukey window multiplier
    let w = 1.0;
    if (i < rampSamples) {
      w = 0.5 * (1 - Math.cos((Math.PI * i) / rampSamples));
    } else if (i > numSamples - rampSamples) {
      w = 0.5 * (1 - Math.cos((Math.PI * (numSamples - i)) / rampSamples));
    }

    samples[i] = w * Math.sin(phase);
    phase = (phase + phaseInc) % (2 * Math.PI);
  }

  return { samples, endPhase: phase };
}

// Goertzel Power Detection Algorithm
function goertzelPower(samples, targetFreq, sampleRate) {
  const N = samples.length;
  const k = (N * targetFreq) / sampleRate;
  const omega = (2 * Math.PI * k) / N;
  const coeff = 2 * Math.cos(omega);

  let sPrev = 0;
  let sPrev2 = 0;

  for (let i = 0; i < N; i++) {
    const s = samples[i] + coeff * sPrev - sPrev2;
    sPrev2 = sPrev;
    sPrev = s;
  }

  const power = sPrev * sPrev + sPrev2 * sPrev2 - coeff * sPrev * sPrev2;
  return power / (N * N);
}

// Packet Binary Serialization & Framing
const MAGIC_BYTE = 0xD5;
const BARKER_13 = [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1];

function buildPacket(profileId, messageId, totalChunks, chunkIndex, payloadBytes) {
  if (payloadBytes.length > 64) {
    throw new Error('Payload exceeds maximum chunk length of 64 bytes');
  }

  // Header: 7 bytes + 1 byte CRC8 = 8 bytes
  // [0] Magic (0xD5)
  // [1] ProfileId (0-3)
  // [2..3] MessageId (uint16 BE)
  // [4] TotalChunks (1-255)
  // [5] ChunkIndex (0-254)
  // [6] PayloadLength (1-64)
  // [7] HeaderCRC8
  const header = new Uint8Array(8);
  header[0] = MAGIC_BYTE;
  header[1] = profileId;
  header[2] = (messageId >> 8) & 0xFF;
  header[3] = messageId & 0xFF;
  header[4] = totalChunks & 0xFF;
  header[5] = chunkIndex & 0xFF;
  header[6] = payloadBytes.length & 0xFF;
  header[7] = crc8(header.subarray(0, 7));

  // Full packet before CRC32: Header (8B) + Payload (LB)
  const fullPacket = new Uint8Array(8 + payloadBytes.length + 4);
  fullPacket.set(header, 0);
  fullPacket.set(payloadBytes, 8);

  // Compute CRC32 over Header + Payload
  const packetCrc32 = crc32(fullPacket.subarray(0, 8 + payloadBytes.length));
  fullPacket[8 + payloadBytes.length] = (packetCrc32 >>> 24) & 0xFF;
  fullPacket[8 + payloadBytes.length + 1] = (packetCrc32 >>> 16) & 0xFF;
  fullPacket[8 + payloadBytes.length + 2] = (packetCrc32 >>> 8) & 0xFF;
  fullPacket[8 + payloadBytes.length + 3] = packetCrc32 & 0xFF;

  return fullPacket;
}

function parsePacket(packetBytes) {
  if (packetBytes.length < 12) { // 8 byte header + 0B payload + 4B CRC32
    return { valid: false, error: 'Packet too short' };
  }

  const magic = packetBytes[0];
  if (magic !== MAGIC_BYTE) {
    return { valid: false, error: 'Magic byte mismatch' };
  }

  const profileId = packetBytes[1];
  const messageId = (packetBytes[2] << 8) | packetBytes[3];
  const totalChunks = packetBytes[4];
  const chunkIndex = packetBytes[5];
  const payloadLen = packetBytes[6];
  const expectedHeaderCrc = packetBytes[7];
  const actualHeaderCrc = crc8(packetBytes.subarray(0, 7));

  if (expectedHeaderCrc !== actualHeaderCrc) {
    return { valid: false, error: 'Header CRC8 check failed' };
  }

  if (packetBytes.length !== 8 + payloadLen + 4) {
    return { valid: false, error: 'Packet size mismatch with header length' };
  }

  const payload = packetBytes.subarray(8, 8 + payloadLen);
  const expectedCrc32 = (
    (packetBytes[8 + payloadLen] << 24) |
    (packetBytes[8 + payloadLen + 1] << 16) |
    (packetBytes[8 + payloadLen + 2] << 8) |
    packetBytes[8 + payloadLen + 3]
  ) >>> 0;

  const actualCrc32 = crc32(packetBytes.subarray(0, 8 + payloadLen));
  if (expectedCrc32 !== actualCrc32) {
    return { valid: false, error: 'Packet CRC32 check failed', expectedCrc32, actualCrc32 };
  }

  return {
    valid: true,
    magic,
    profileId,
    messageId,
    totalChunks,
    chunkIndex,
    payloadLen,
    payload,
    crc32: actualCrc32
  };
}

// Chunking and Reassembly Engine
class PacketReassembler {
  constructor(timeoutMs = 30000) {
    this.messages = new Map();
    this.recentCompleted = new Set();
    this.timeoutMs = timeoutMs;
  }

  addPacket(packet) {
    if (!packet.valid) return { status: 'invalid', error: packet.error };
    const { messageId, totalChunks, chunkIndex, payload } = packet;

    if (this.recentCompleted.has(messageId)) {
      return { status: 'duplicate_message', messageId };
    }

    if (!this.messages.has(messageId)) {
      this.messages.set(messageId, {
        totalChunks,
        chunks: new Array(totalChunks).fill(null),
        receivedCount: 0,
        createdAt: Date.now()
      });
    }

    const state = this.messages.get(messageId);
    if (state.chunks[chunkIndex] !== null) {
      return { status: 'duplicate_chunk', messageId, chunkIndex };
    }

    state.chunks[chunkIndex] = new Uint8Array(payload);
    state.receivedCount++;

    if (state.receivedCount === totalChunks) {
      // Concatenate in strict order
      let totalLen = 0;
      for (const c of state.chunks) totalLen += c.length;
      const fullBytes = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of state.chunks) {
        fullBytes.set(c, offset);
        offset += c.length;
      }
      this.recentCompleted.add(messageId);
      this.messages.delete(messageId);

      const decodedText = decodeUtf8(fullBytes);
      return { status: 'complete', messageId, text: decodedText, rawBytes: fullBytes };
    }

    return { status: 'partial', messageId, progress: state.receivedCount / totalChunks };
  }
}

// Acoustic Channel Simulator with Noise and Doppler
class AcousticChannelSimulator {
  static addNoise(samples, snrDb) {
    const noisy = new Float32Array(samples.length);
    // Calculate signal power
    let sigPower = 0;
    for (let i = 0; i < samples.length; i++) sigPower += samples[i] * samples[i];
    sigPower /= samples.length;

    // Calculate noise variance based on SNR
    const snrLinear = Math.pow(10, snrDb / 10);
    const noiseVariance = sigPower / snrLinear;
    const noiseStd = Math.sqrt(noiseVariance);

    for (let i = 0; i < samples.length; i++) {
      // Box-Muller transform for AWGN
      const u1 = Math.random() || 1e-7;
      const u2 = Math.random() || 1e-7;
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      noisy[i] = samples[i] + z0 * noiseStd;
    }
    return noisy;
  }

  static applyDoppler(samples, sampleRate, freqShiftHz) {
    if (Math.abs(freqShiftHz) < 1e-4) return samples;
    // Phase modulation by freqShift
    const shifted = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const phase = (2 * Math.PI * freqShiftHz * i) / sampleRate;
      shifted[i] = samples[i] * Math.cos(phase);
    }
    return shifted;
  }

  static applyMultipathEcho(samples, sampleRate, delayMs = 15, attenuation = 0.3) {
    const delaySamples = Math.floor((delayMs / 1000) * sampleRate);
    const output = new Float32Array(samples.length + delaySamples);
    output.set(samples, 0);
    for (let i = 0; i < samples.length; i++) {
      output[i + delaySamples] += samples[i] * attenuation;
    }
    return output;
  }
}

// Mock IndexedDB Private Message Vault
class MockIndexedDBVault {
  constructor() {
    this.records = new Map();
  }

  async putMessage(record) {
    if (!record.id && !record.messageId) throw new Error('Record must have id or messageId');
    const id = record.id || record.messageId;
    this.records.set(id, { ...record, storedAt: Date.now() });
    return id;
  }

  async getMessage(id) {
    return this.records.get(id) || null;
  }

  async getAllMessages() {
    return Array.from(this.records.values());
  }

  async deleteMessage(id) {
    return this.records.delete(id);
  }

  async clear() {
    this.records.clear();
  }
}

// Mock Firebase Service & Security Rules Validator
class MockFirebaseHarness {
  constructor() {
    this.currentUser = null;
    this.collections = {
      profiles: new Map(),
      preferences: new Map(),
      message_history: new Map(),
      devices: new Map(),
      feedback: new Map()
    };
  }

  signInGuest(uid = `guest_${Math.random().toString(36).substring(2, 9)}`) {
    this.currentUser = { uid, isAnonymous: true, role: 'user', email: null };
    return this.currentUser;
  }

  signInUser(uid, email, role = 'user') {
    this.currentUser = { uid, isAnonymous: false, role, email };
    return this.currentUser;
  }

  signInAdmin(uid, email = 'admin@ultralink.internal') {
    this.currentUser = { uid, isAnonymous: false, role: 'admin', email };
    return this.currentUser;
  }

  signOut() {
    this.currentUser = null;
  }

  // Security Rules RBAC Policy Verification
  validateWrite(collection, docId, data, isCreate = true) {
    if (!this.currentUser) return { allowed: false, reason: 'Unauthenticated' };

    // 1. Profiles collection rules
    if (collection === 'profiles') {
      if (docId !== this.currentUser.uid && this.currentUser.role !== 'admin') {
        return { allowed: false, reason: 'Cross-user write forbidden' };
      }
      if (data.role === 'admin' && this.currentUser.role !== 'admin') {
        return { allowed: false, reason: 'Privilege escalation prevented: cannot assign admin role' };
      }
      return { allowed: true };
    }

    // 2. Preferences collection rules
    if (collection === 'preferences') {
      if (docId !== this.currentUser.uid) {
        return { allowed: false, reason: 'Preferences can only be modified by owner' };
      }
      return { allowed: true };
    }

    // 3. Message history (Telemetry only, zero plaintext)
    if (collection === 'message_history') {
      if (data.ownerId !== this.currentUser.uid) {
        return { allowed: false, reason: 'ownerId must match auth.uid' };
      }
      if (data.text || data.plaintextContent || data.payload) {
        return { allowed: false, reason: 'Architectural privacy violation: zero plaintext allowed in Firestore' };
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

  validateRead(collection, docId) {
    if (!this.currentUser) return { allowed: false, reason: 'Unauthenticated' };

    if (collection === 'profiles' || collection === 'preferences') {
      if (docId === this.currentUser.uid || this.currentUser.role === 'admin') {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Owner or admin read only' };
    }

    if (collection === 'message_history') {
      const doc = this.collections.message_history.get(docId);
      if (!doc) return { allowed: true }; // non-existent check allowed
      if (doc.ownerId === this.currentUser.uid) return { allowed: true };
      return { allowed: false, reason: 'Private telemetry isolated to owner only' };
    }

    if (collection === 'devices' || collection === 'feedback') {
      return { allowed: true };
    }

    return { allowed: false, reason: 'Default-deny' };
  }
}

module.exports = {
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
};
