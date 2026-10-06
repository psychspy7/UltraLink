import { describe, it, expect } from 'vitest';
import { encodeWav, decodeWav, encodeTextToWav } from '../../lib/dsp/wav';
import { PROFILES } from '../../lib/dsp/profiles';

describe('Pure TypeScript RIFF WAV Codec', () => {
  it('encodes and decodes 16-bit PCM audio with high numerical fidelity', () => {
    const sampleRate = 48000;
    const numSamples = 4800; // 100ms
    const inputSamples = new Float32Array(numSamples);

    // Generate test tone (17.5 kHz sine wave)
    const freq = 17500;
    for (let i = 0; i < numSamples; i++) {
      inputSamples[i] = 0.75 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }

    const wavBytes = encodeWav(inputSamples, sampleRate, 1);
    expect(wavBytes.length).toBe(44 + numSamples * 2);

    const decoded = decodeWav(wavBytes);
    expect(decoded.sampleRate).toBe(sampleRate);
    expect(decoded.numChannels).toBe(1);
    expect(decoded.bitsPerSample).toBe(16);
    expect(decoded.samples.length).toBe(numSamples);

    // Quantization error for 16-bit PCM is bounded by 1 / 32768 (~0.00003)
    let maxDiff = 0;
    for (let i = 0; i < numSamples; i++) {
      const diff = Math.abs(inputSamples[i] - decoded.samples[i]);
      if (diff > maxDiff) maxDiff = diff;
    }
    expect(maxDiff).toBeLessThan(0.0001);
  });

  it('supports 44.1 kHz sample rate encoding and decoding', () => {
    const sampleRate = 44100;
    const samples = new Float32Array(4410); // 100ms
    const wavBytes = encodeWav(samples, sampleRate, 1);

    const decoded = decodeWav(wavBytes);
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.samples.length).toBe(4410);
  });

  it('correctly downmixes stereo WAV files to mono', () => {
    const sampleRate = 48000;
    const stereoSamplesPerChannel = 2400;
    const stereoDataSize = stereoSamplesPerChannel * 2 * 2; // 2 channels * 2 bytes/sample
    const buffer = new ArrayBuffer(44 + stereoDataSize);
    const view = new DataView(buffer);

    // Write minimal valid stereo WAV
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + stereoDataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 2, true); // Stereo (2 channels)
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, stereoDataSize, true);

    // Left channel: +0.5, Right channel: -0.5 -> average should be 0.0
    let off = 44;
    for (let i = 0; i < stereoSamplesPerChannel; i++) {
      view.setInt16(off, Math.round(0.5 * 32767), true); // Left
      view.setInt16(off + 2, Math.round(-0.5 * 32767), true); // Right
      off += 4;
    }

    const decoded = decodeWav(new Uint8Array(buffer));
    expect(decoded.numChannels).toBe(2);
    expect(decoded.samples.length).toBe(stereoSamplesPerChannel);

    for (let i = 0; i < decoded.samples.length; i++) {
      expect(Math.abs(decoded.samples[i])).toBeLessThan(0.001);
    }
  });

  it('generates downloadable WAV files from text using encodeTextToWav', () => {
    const text = 'Offline WAV Transmission';
    const wavBytes = encodeTextToWav(text, PROFILES.balanced, 48000);
    expect(wavBytes.length).toBeGreaterThan(44);

    const decoded = decodeWav(wavBytes);
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.samples.length).toBeGreaterThan(1000);
  });

  it('rejects corrupted or truncated WAV headers with clear errors', () => {
    expect(() => decodeWav(new Uint8Array(20))).toThrow(/too small/);
    expect(() => decodeWav(new Uint8Array(50))).toThrow(/expected 'RIFF'/);
  });
});
