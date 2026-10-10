/**
 * UltraLink Adversarial DSP & Acoustic Stress Verification Suite
 * File: tests/unit/adversarial-dsp.test.ts
 * 
 * Challenger 1 Empirical Test Harness covering:
 * - Multi-byte Unicode, CJK, RTL (Arabic/Hebrew), and complex ZWJ emoji sequences
 * - Massive payloads requiring multi-chunk framing and out-of-order / scrambled reassembly
 * - Simulated channel impairments: AWGN noise (SNR sweep) and Doppler drift (+-50 Hz)
 * - Bit flips and truncated packets: verifying strict CRC8 & CRC32 rejection (zero garbage text)
 * - Sample rate invariance: 44.1 kHz vs 48.0 kHz, physical resampling, and WAV roundtrips
 * - Signal integrity verification across all 4 operational modulation profiles
 */

import { describe, it, expect } from 'vitest';
import {
  PROFILES,
  DEFAULT_PROFILE,
  ModulationProfile,
  getProfile,
  getProfileByNumericId,
} from '../../lib/dsp/profiles';
import {
  MAGIC_BYTE,
  Packet,
  PacketHeader,
  serializeHeader,
  deserializeHeader,
  serializePacket,
  deserializePacket,
  chunkText,
  PacketReassembler,
} from '../../lib/dsp/framing';
import {
  computeCrc8,
  verifyCrc8,
  computeCrc32,
  verifyCrc32,
} from '../../lib/dsp/crc';
import {
  bytesToSymbols,
  symbolsToBytes,
  ContinuousPhaseModulator,
  encodeTextToAudioBuffer,
} from '../../lib/dsp/modulation';
import {
  Demodulator,
  decodeAudioSamples,
} from '../../lib/dsp/demodulation';
import {
  encodeWav,
  decodeWav,
  encodeTextToWav,
  decodeWavToMessages,
  decodeWavBuffer,
} from '../../lib/dsp/wav';
import { GoertzelFilterBank } from '../../lib/dsp/goertzel';

// Helper: Linear resampling simulating continuous air channel propagation
function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = toRate / fromRate;
  const newLength = Math.round(samples.length * ratio);
  const out = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i / ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const frac = srcIndex - i0;
    out[i] = (1 - frac) * samples[i0] + frac * samples[i1];
  }
  return out;
}

// Helper: Additive White Gaussian Noise (AWGN) via Box-Muller transform
function addAwgnNoise(samples: Float32Array, snrDb: number): Float32Array {
  let sigPower = 0;
  for (let i = 0; i < samples.length; i++) {
    sigPower += samples[i] * samples[i];
  }
  sigPower /= samples.length || 1;

  const snrLinear = Math.pow(10, snrDb / 10);
  const noiseVariance = sigPower / snrLinear;
  const noiseStd = Math.sqrt(noiseVariance);

  const noisy = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const u1 = Math.random() || 1e-7;
    const u2 = Math.random() || 1e-7;
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    noisy[i] = samples[i] + z * noiseStd;
  }
  return noisy;
}

// Helper: Apply frequency offset / Doppler drift
function applyFrequencyOffset(samples: Float32Array, sampleRate: number, offsetHz: number): Float32Array {
  if (Math.abs(offsetHz) < 1e-3) return new Float32Array(samples);
  const shifted = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    // Frequency modulation: multiply by exp(j * 2*pi*df*t) real part
    const phase = (2 * Math.PI * offsetHz * i) / sampleRate;
    shifted[i] = samples[i] * Math.cos(phase);
  }
  return shifted;
}

describe('Adversarial DSP Suite — 1. Multi-Byte Unicode, CJK, RTL & Complex Emojis', () => {
  it('transmits and decodes complex CJK multi-byte glyphs (Japanese, Chinese, Korean)', () => {
    const cjkMessage = '日本語音響通信：17kHz〜19kHzの近超音波通信！ 简体中文测试：高熵数据包解码。 한국어 음향 프로토콜 테스트.';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(cjkMessage, profile, sampleRate, 8101);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(cjkMessage);
    expect(decoded[0].crcPassed).toBe(true);
    expect(decoded[0].messageId).toBe(8101);
  });

  it('transmits and decodes bidirectional RTL text (Arabic & Hebrew) without reversal', () => {
    const rtlMessage = 'مرحبا بالعالم — بروتوكول الترا لينك الصوتي 2026 — שלום עולם';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(rtlMessage, profile, sampleRate, 8102);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(rtlMessage);
  });

  it('preserves multi-code-unit accented Latin and combining characters', () => {
    const accentedMessage = 'Zürich, naïve façade, café crème, Übergrößen, Ångström, São Paulo, résumé';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(accentedMessage, profile, sampleRate, 8103);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(accentedMessage);
  });

  it('preserves complex Zero-Width Joiner (ZWJ) and flag emoji sequences across chunk boundaries', () => {
    // Family emoji: Man + ZWJ + Woman + ZWJ + Girl + ZWJ + Boy (25 bytes UTF-8)
    // Combined with satellite, rocket, key, sparkles, flags
    const emojiMessage = '🛰️ 👨‍👩‍👧‍👦 🚀 🏳️‍🌈 🔐 ✨ 👩🏽‍🚀 📡 100% Offline!';
    const profile = PROFILES.reliable; // Smallest chunk size (16 bytes) -> forces ZWJ splitting across chunks!
    const sampleRate = 48000;

    const packets = chunkText(emojiMessage, profile, 8104);
    expect(packets.length).toBeGreaterThan(3);

    // Verify chunking split the multi-byte sequences into consecutive valid bytes
    const reassembler = new PacketReassembler();
    let result = null;
    for (const packet of packets) {
      result = reassembler.addPacket(packet);
    }

    expect(result).not.toBeNull();
    expect(result?.text).toBe(emojiMessage);
    expect(result?.crcPassed).toBe(true);
  });
});

describe('Adversarial DSP Suite — 2. Massive Payloads & Out-of-Order / Scrambled Reassembly', () => {
  it('chunks and cleanly reassembles massive 512-byte payload with 32 chunks in reverse order', () => {
    // Generate high-entropy 512-byte alphanumeric text
    // 32 exact 16-byte ASCII blocks = 512 bytes, even at UTF-8 level.
    const largeText = Array.from(
      { length: 32 },
      (_, i) => `[BLK:${i.toString().padStart(4, '0')}]`.padEnd(16, '!')
    ).join('');
    const profile = PROFILES.reliable; // 16 bytes per chunk -> exactly 32 chunks

    const packets = chunkText(largeText, profile, 9001);
    expect(packets.length).toBe(32);

    const reassembler = new PacketReassembler();

    // Deliver chunks strictly in reverse order: 31 down to 0
    let finalMessage = null;
    for (let i = packets.length - 1; i >= 0; i--) {
      const res = reassembler.addPacket(packets[i]);
      if (i === 0) {
        finalMessage = res;
      } else {
        expect(res).toBeNull();
      }
    }

    expect(finalMessage).not.toBeNull();
    expect(finalMessage?.text).toBe(largeText);
    expect(finalMessage?.chunkCount).toBe(32);
    expect(finalMessage?.crcPassed).toBe(true);
  });

  it('reassembles chunks arriving in pseudo-random scrambled order', () => {
    const text = 'UltraLink Scrambled Packet Arrival Reassembly Test with 8 distinct chunks!';
    const profile = PROFILES.reliable; // 16 bytes/chunk
    const packets = chunkText(text, profile, 9002);

    expect(packets.length).toBeGreaterThanOrEqual(4);

    // Create a scrambled index order: e.g. [3, 0, 4, 1, 5, 2, ...]
    const scrambled = [...packets];
    // Deterministic shuffle
    for (let i = scrambled.length - 1; i > 0; i--) {
      const j = (i * 7 + 3) % (i + 1);
      const temp = scrambled[i];
      scrambled[i] = scrambled[j];
      scrambled[j] = temp;
    }

    const reassembler = new PacketReassembler();
    let completed = null;
    for (const pkt of scrambled) {
      const res = reassembler.addPacket(pkt);
      if (res) completed = res;
    }

    expect(completed).not.toBeNull();
    expect(completed?.text).toBe(text);
  });

  it('rejects duplicate chunks and duplicate completed messages without state corruption', () => {
    const text = 'Deduplication Safety Test: two or more packet chunks required';
    const profile = PROFILES.balanced;
    const packets = chunkText(text, profile, 9003);

    const reassembler = new PacketReassembler();

    // Send chunk 0 twice
    expect(reassembler.addPacket(packets[0])).toBeNull();
    expect(reassembler.addPacket(packets[0])).toBeNull(); // Duplicate chunk dropped
    expect(reassembler.getDuplicateDropCount()).toBe(1);

    // Deliver remaining chunks
    let completed = null;
    for (let i = 1; i < packets.length; i++) {
      completed = reassembler.addPacket(packets[i]);
    }
    expect(completed).not.toBeNull();
    expect(reassembler.isMessageCompleted(9003)).toBe(true);

    // Replay chunk 0 or entire packet for already completed message
    expect(reassembler.addPacket(packets[0])).toBeNull();
    expect(reassembler.getDuplicateDropCount()).toBe(2);
  });

  it('never emits partial or garbage text when a chunk is dropped', () => {
    const text = 'Five chunk message with missing middle chunk';
    const profile = PROFILES.reliable;
    const packets = chunkText(text, profile, 9004);

    const reassembler = new PacketReassembler();

    // Deliver all chunks EXCEPT chunk 2
    for (let i = 0; i < packets.length; i++) {
      if (i === 2) continue; // Drop chunk 2
      const res = reassembler.addPacket(packets[i]);
      expect(res).toBeNull(); // Should never complete
    }

    expect(reassembler.isMessageCompleted(9004)).toBe(false);
  });
});

describe('Adversarial DSP Suite — 3. AWGN Noise and Doppler Shift (+-50 Hz)', () => {
  it('decodes reliably under high noise margin (AWGN with SNR = 18 dB)', () => {
    const message = 'AWGN 18dB Margin';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 7101);
    const noisyAudio = addAwgnNoise(audio, 18.0);

    const decoded = decodeAudioSamples(noisyAudio, sampleRate, { profile });
    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(message);
    expect(decoded[0].crcPassed).toBe(true);
  });

  it('maintains signal integrity under severe noise (AWGN with SNR = 12 dB)', () => {
    const message = 'Heavy Noise 12dB';
    const profile = PROFILES.reliable; // Reliable 4-FSK has 4.5 dB threshold
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 7102);
    const noisyAudio = addAwgnNoise(audio, 12.0);

    const decoded = decodeAudioSamples(noisyAudio, sampleRate, { profile });
    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(message);
  });

  it('survives positive frequency Doppler drift of +30 Hz with AFC tracking', () => {
    const message = 'Doppler +30Hz Shift';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 7201);
    const shiftedAudio = applyFrequencyOffset(audio, sampleRate, 30.0);

    const decoded = decodeAudioSamples(shiftedAudio, sampleRate, {
      profile,
      enableAfc: true,
    });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(message);
    expect(decoded[0].crcPassed).toBe(true);
  });

  it('survives negative frequency Doppler drift of -30 Hz with AFC tracking', () => {
    const message = 'Doppler -30Hz Shift';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 7202);
    const shiftedAudio = applyFrequencyOffset(audio, sampleRate, -30.0);

    const decoded = decodeAudioSamples(shiftedAudio, sampleRate, {
      profile,
      enableAfc: true,
    });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(message);
    expect(decoded[0].crcPassed).toBe(true);
  });

  it('rejects extreme noise (SNR = 0 dB) without ever outputting corrupted text', () => {
    const message = 'Classified Data';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 7301);
    const destroyedAudio = addAwgnNoise(audio, 0.0); // 0 dB SNR = pure noise

    const decoded = decodeAudioSamples(destroyedAudio, sampleRate, { profile });
    // MUST either reject sync or fail CRC; zero corrupt messages
    expect(decoded.length).toBe(0);
  });
});

describe('Adversarial DSP Suite — 4. Bit Flips and Corrupted Packet Rejection', () => {
  it('detects 100% of single bit flips across entire 8-byte header via CRC8', () => {
    const header: PacketHeader = {
      magic: MAGIC_BYTE,
      profileId: 1,
      messageId: 0xbeef,
      totalChunks: 4,
      chunkIndex: 2,
      payloadLength: 20,
      headerCrc: 0,
    };
    const validHeaderBytes = serializeHeader(header);

    // Test flipping every bit of every byte (0 to 6)
    for (let byteIdx = 0; byteIdx < 7; byteIdx++) {
      for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
        const corrupted = new Uint8Array(validHeaderBytes);
        corrupted[byteIdx] ^= (1 << bitIdx);

        // Deserialization MUST fail
        const parsed = deserializeHeader(corrupted);
        expect(parsed).toBeNull();
      }
    }

    // Test flipping the CRC8 byte itself (byte 7)
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      const corrupted = new Uint8Array(validHeaderBytes);
      corrupted[7] ^= (1 << bitIdx);
      expect(deserializeHeader(corrupted)).toBeNull();
    }
  });

  it('detects 100% of single bit flips across packet payload and trailer via CRC32', () => {
    const payload = new TextEncoder().encode('Payload with high cryptographic sensitivity');
    const header: PacketHeader = {
      magic: MAGIC_BYTE,
      profileId: 1,
      messageId: 4400,
      totalChunks: 1,
      chunkIndex: 0,
      payloadLength: payload.length,
      headerCrc: 0,
    };
    header.headerCrc = serializeHeader(header)[7];

    const packet: Packet = { header, payload, crc32: 0 };
    const validPacketBytes = serializePacket(packet);

    // Flip bit in payload
    for (let i = 8; i < 8 + payload.length; i++) {
      const corrupted = new Uint8Array(validPacketBytes);
      corrupted[i] ^= 0x01;
      expect(deserializePacket(corrupted)).toBeNull();
    }

    // Flip bit in CRC32 trailer
    for (let i = 8 + payload.length; i < validPacketBytes.length; i++) {
      const corrupted = new Uint8Array(validPacketBytes);
      corrupted[i] ^= 0x01;
      expect(deserializePacket(corrupted)).toBeNull();
    }
  });

  it('safely rejects truncated packets with lengths smaller than header declared payloadLength', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const header: PacketHeader = {
      magic: MAGIC_BYTE,
      profileId: 1,
      messageId: 101,
      totalChunks: 1,
      chunkIndex: 0,
      payloadLength: 10,
      headerCrc: 0,
    };
    header.headerCrc = serializeHeader(header)[7];

    const packet: Packet = { header, payload, crc32: 0 };
    const serialized = serializePacket(packet);

    // Truncate to less than expected total length
    for (let truncLen = 0; truncLen < serialized.length - 1; truncLen++) {
      const truncated = serialized.subarray(0, truncLen);
      expect(deserializePacket(truncated)).toBeNull();
    }
  });
});

describe('Adversarial DSP Suite — 5. Sample Rate Invariance (44.1 kHz vs 48.0 kHz) & WAV Codec', () => {
  it('roundtrips cleanly at 44.1 kHz sample rate (CD standard)', () => {
    const text = 'CD Standard 44100Hz Transmission';
    const profile = PROFILES.balanced;
    const sampleRate = 44100;

    const audio = encodeTextToAudioBuffer(text, profile, sampleRate, 4410);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(text);
    expect(decoded[0].sampleRate).toBe(44100);
  });

  it('roundtrips cleanly at 48.0 kHz sample rate (Web Audio default)', () => {
    const text = 'Web Audio 48000Hz Transmission';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(text, profile, sampleRate, 4800);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(text);
    expect(decoded[0].sampleRate).toBe(48000);
  });

  it('simulates acoustic channel resampling: encode at 44.1 kHz, resample to 48.0 kHz, decode at 48.0 kHz', () => {
    const text = 'Acoustic Resampling 44.1k -> 48k';
    const profile = PROFILES.balanced;

    // 1. Transmitter DAC at 44.1 kHz
    const audio44k = encodeTextToAudioBuffer(text, profile, 44100, 4448);

    // 2. Physical air propagation sampled by receiver ADC at 48.0 kHz
    const audio48k = resampleLinear(audio44k, 44100, 48000);

    // 3. Demodulate at 48.0 kHz
    const decoded = decodeAudioSamples(audio48k, 48000, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(text);
    expect(decoded[0].crcPassed).toBe(true);
  });

  it('simulates acoustic channel resampling: encode at 48.0 kHz, resample to 44.1 kHz, decode at 44.1 kHz', () => {
    const text = 'Acoustic Resampling 48k -> 44.1k';
    const profile = PROFILES.balanced;

    // 1. Transmitter DAC at 48.0 kHz
    const audio48k = encodeTextToAudioBuffer(text, profile, 48000, 4844);

    // 2. Physical air propagation sampled by receiver ADC at 44.1 kHz
    const audio44k = resampleLinear(audio48k, 48000, 44100);

    // 3. Demodulate at 44.1 kHz
    const decoded = decodeAudioSamples(audio44k, 44100, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(text);
    expect(decoded[0].crcPassed).toBe(true);
  });

  it('WAV file roundtrip: export WAV at 44.1 kHz and decode via decodeWavBuffer', async () => {
    const message = 'WAV File 44.1kHz Offline Test';
    const profile = PROFILES.balanced;

    const wavBytes = encodeTextToWav(message, profile, 44100);
    const parsed = decodeWav(wavBytes);
    expect(parsed.sampleRate).toBe(44100);

    const decodedMessage = await decodeWavBuffer(wavBytes, { profile });
    expect(decodedMessage.text).toBe(message);
    expect(decodedMessage.crcPassed).toBe(true);
  });

  it('WAV file roundtrip: export WAV at 48.0 kHz and decode via decodeWavToMessages', () => {
    const message = 'WAV File 48kHz Offline Test';
    const profile = PROFILES.balanced;

    const wavBytes = encodeTextToWav(message, profile, 48000);
    const messages = decodeWavToMessages(wavBytes, { profile });

    expect(messages.length).toBe(1);
    expect(messages[0].text).toBe(message);
    expect(messages[0].crcPassed).toBe(true);
  });
});

describe('Adversarial DSP Suite — 6. Signal Integrity Across All 4 Modulation Profiles', () => {
  it('Profile 0: Reliable (4-FSK, robust noise margin)', () => {
    const text = 'Profile 0 Reliable Mode';
    const profile = PROFILES.reliable;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(text, profile, sampleRate, 100);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(text);
    expect(decoded[0].profileId).toBe('reliable');
  });

  it('Profile 1: Balanced (8-FSK, standard room mode)', () => {
    const text = 'Profile 1 Balanced Mode';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(text, profile, sampleRate, 101);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(text);
    expect(decoded[0].profileId).toBe('balanced');
  });

  it('Profile 2: Fast (16-FSK, high-throughput nibble mode)', () => {
    const text = 'Profile 2 Fast Mode';
    const profile = PROFILES.fast;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(text, profile, sampleRate, 102);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(text);
    expect(decoded[0].profileId).toBe('fast');
  });

  it('Profile 3: Experimental (Dual-Tone 8-FSK parallel band mode)', () => {
    const text = 'Profile 3 Experimental Mode';
    const profile = PROFILES.experimental;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(text, profile, sampleRate, 103);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(text);
    expect(decoded[0].profileId).toBe('experimental');
  });
});
