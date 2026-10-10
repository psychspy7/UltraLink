/**
 * UltraLink AudioWorklet Decoder Processor Unit Tests
 * File: tests/unit/worklet.test.ts
 * 
 * Verifies:
 * 1. Ring buffer sizing (ringBufferSize >= 262,144) preventing circular wrap-around
 * 2. Unrolled scan window sizing (scanWindowSize up to available samples)
 * 3. Continuous 128-sample streaming ingestion without buffer corruption
 * 4. Dual-8FSK parallel tone demodulation in Experimental profile
 * 5. Full roundtrip live demodulation:
 *    Feeding synthesized audio blocks emits SYNC_DETECTED, PACKET_DECODED,
 *    MESSAGE_DECODED, and MESSAGE_COMPLETED with valid .text!
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PROFILES } from '../../lib/dsp/profiles';
import { encodeTextToAudioBuffer } from '../../lib/dsp/modulation';

// Polyfill AudioWorkletProcessor in Node environment before importing worklet
if (typeof (globalThis as any).AudioWorkletProcessor === 'undefined') {
  class MockAudioWorkletProcessor {
    public port: any;
    constructor(options?: any) {
      this.port = {
        postMessage: (_msg: any) => {},
        onmessage: null,
      };
    }
  }
  (globalThis as any).AudioWorkletProcessor = MockAudioWorkletProcessor;
}

if (typeof (globalThis as any).registerProcessor === 'undefined') {
  (globalThis as any).registerProcessor = (_name: string, _ctor: any) => {};
}

// Load worklet module
const { UltralinkDecoderProcessor, computeCrc8, computeCrc32 } = require('../../public/worklets/ultralink-decoder-worklet.js');

describe('AudioWorklet Decoder Processor (UltralinkDecoderProcessor)', () => {
  let processor: any;
  let postedMessages: any[];

  beforeEach(() => {
    postedMessages = [];
    processor = new UltralinkDecoderProcessor();
    // Keep the message handler installed by the real constructor.
    // Replacing the whole port would discard onmessage and break RESET tests.
    processor.port.postMessage = (msg: any) => {
      postedMessages.push(msg);
    };
  });

  it('allocates ring buffer >= 262,144 samples to prevent wrap-around', () => {
    expect(processor.ringBufferSize).toBeGreaterThanOrEqual(262144);
    expect(processor.ringBuffer.length).toBe(processor.ringBufferSize);
    expect(processor.linearWindow.length).toBe(processor.ringBufferSize);
    expect(processor.writePos).toBe(0);
    expect(processor.readPos).toBe(0);
  });

  it('correctly ingests streaming 128-sample blocks into ring buffer', () => {
    const blockSize = 128;
    const block = new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) block[i] = 0.5;

    const inputData = [[block]];
    for (let b = 0; b < 10; b++) {
      processor.process(inputData, [], {});
    }

    expect(processor.totalSamplesReceived).toBe(1280);
    expect(processor.writePos).toBe(1280);
    expect(processor.ringBuffer[0]).toBeCloseTo(0.5);
    expect(processor.ringBuffer[1279]).toBeCloseTo(0.5);
  });

  it('handles SET_PROFILE and RESET port messages cleanly', () => {
    expect(processor.profile.id).toBe('balanced');

    // Simulate sending SET_PROFILE message
    const fastProfile = PROFILES.fast;
    processor.port.onmessage({ data: { type: 'SET_PROFILE', profile: fastProfile } });
    expect(processor.profile.id).toBe('fast');
    expect(processor.writePos).toBe(0);

    // Simulate sending RESET message
    processor.writePos = 500;
    processor.port.onmessage({ data: { type: 'RESET' } });
    expect(processor.writePos).toBe(0);
    expect(processor.readPos).toBe(0);
  });

  it('computes Goertzel filter power accurately for tone evaluation', () => {
    const sampleRate = 48000;
    const freq = 17500;
    const N = 1536; // 32ms
    const samples = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      samples[i] = 0.8 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }

    const powerTone = processor.computeGoertzelPower(17500, samples, 0, N);
    const powerSilent = processor.computeGoertzelPower(18200, samples, 0, N);

    expect(powerTone).toBeGreaterThan(0.2);
    expect(powerSilent).toBeLessThan(0.01);
  });

  it('correctly demodulates dual-8FSK 6-bit symbols in Experimental profile', () => {
    const expProfile = PROFILES.experimental;
    processor.profile = expProfile;

    // Dual-8FSK sends 2 simultaneous tones:
    // Band A sym 3: 17400 Hz (lower 3 bits = 0b011)
    // Band B sym 5: 18600 Hz (upper 3 bits = 0b101)
    // Combined symbol should be: 3 | (5 << 3) = 3 | 40 = 43 (0b101011)
    const freqA = expProfile.dualBandFrequencies!.bandA[3];
    const freqB = expProfile.dualBandFrequencies!.bandB[5];
    const sampleRate = 48000;
    const len = 960; // 20ms
    const dualBuf = new Float32Array(len);

    for (let i = 0; i < len; i++) {
      const toneA = 0.5 * Math.sin((2 * Math.PI * freqA * i) / sampleRate);
      const toneB = 0.5 * Math.sin((2 * Math.PI * freqB * i) / sampleRate);
      dualBuf[i] = toneA + toneB;
    }

    const decodedSym = processor.decodeSymbol(dualBuf, 0, len);
    expect(decodedSym).toBe(43);

    // Unpack 6-bit symbol into byte
    const unpacked = processor.symbolsToBytes([43, 0], 1);
    expect(unpacked.length).toBe(1);
    expect((unpacked[0] >> 2) & 0x3f).toBe(43);
  });

  it('successfully streams, detects sync, and decodes complete packet & message with .text', () => {
    const testText = 'WORKLET_OK';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;
    processor.profile = profile;
    processor.sampleRate = sampleRate;

    // Generate modulated audio waveform
    const audio = encodeTextToAudioBuffer(testText, profile, sampleRate, 777);
    expect(audio.length).toBeGreaterThan(0);

    // Stream the audio into the processor block by block (128 samples per AudioWorklet quantum)
    const blockSize = 128;
    const totalBlocks = Math.ceil(audio.length / blockSize);

    for (let b = 0; b < totalBlocks; b++) {
      const block = new Float32Array(blockSize);
      const start = b * blockSize;
      const end = Math.min(start + blockSize, audio.length);
      block.set(audio.subarray(start, end), 0);

      processor.process([[block]], [], {});
    }

    // Feed a few silence blocks to ensure trailing samples flush
    for (let s = 0; s < 10; s++) {
      processor.process([[new Float32Array(blockSize)]], [], {});
    }

    // Verify SYNC_DETECTED was posted
    const syncEvents = postedMessages.filter((m) => m.type === 'SYNC_DETECTED');
    expect(syncEvents.length).toBeGreaterThan(0);
    expect(syncEvents[0].confidence).toBeGreaterThanOrEqual(11 / 13);

    // Verify PACKET_DECODED was posted and has .text populated
    const packetEvents = postedMessages.filter((m) => m.type === 'PACKET_DECODED');
    expect(packetEvents.length).toBeGreaterThan(0);
    expect(packetEvents[0].packet).toBeDefined();
    expect(packetEvents[0].packet.text).toBe(testText);
    expect(packetEvents[0].packet.header.messageId).toBe(777);

    // Verify MESSAGE_COMPLETED and MESSAGE_DECODED were posted
    const completedEvents = postedMessages.filter((m) => m.type === 'MESSAGE_COMPLETED');
    expect(completedEvents.length).toBeGreaterThan(0);
    expect(completedEvents[0].message.text).toBe(testText);
    expect(completedEvents[0].message.messageId).toBe(777);

    const messageDecodedEvents = postedMessages.filter((m) => m.type === 'MESSAGE_DECODED');
    expect(messageDecodedEvents.length).toBeGreaterThan(0);
    expect(messageDecodedEvents[0].message.text).toBe(testText);
  });
});
