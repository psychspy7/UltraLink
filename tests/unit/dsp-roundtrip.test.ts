import { describe, it, expect } from 'vitest';
import { PROFILES, DEFAULT_PROFILE } from '../../lib/dsp/profiles';
import { encodeTextToAudioBuffer } from '../../lib/dsp/modulation';
import { decodeAudioSamples, Demodulator } from '../../lib/dsp/demodulation';
import { encodeTextToWav, decodeWavToMessages } from '../../lib/dsp/wav';
import { GoertzelFilterBank } from '../../lib/dsp/goertzel';

describe('Goertzel Filter Bank & Peak Detection', () => {
  it('accurately resolves continuous frequencies without FFT bin straddle', () => {
    const sampleRate = 48000;
    const testFreq = 17500;
    const numSamples = 1536; // 32ms
    const samples = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      samples[i] = 0.8 * Math.sin((2 * Math.PI * testFreq * i) / sampleRate);
    }

    const targetFreqs = [17200, 17350, 17500, 17650, 17800];
    const bank = new GoertzelFilterBank(targetFreqs, sampleRate);
    const result = bank.evaluate(samples);

    expect(result.peakIndex).toBe(2);
    expect(result.peakFrequency).toBe(17500);
    expect(result.snrDb).toBeGreaterThan(15);
  });

  it('refines frequency peak with parabolic interpolation', () => {
    const sampleRate = 48000;
    const trueFreq = 17525; // Shifted by +25 Hz from 17500
    const numSamples = 1536;
    const samples = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      samples[i] = 0.8 * Math.sin((2 * Math.PI * trueFreq * i) / sampleRate);
    }

    const bank = new GoertzelFilterBank([17500], sampleRate);
    const refined = bank.refinePeakFrequency(samples, 17500, 50);

    expect(Math.abs(refined - trueFreq)).toBeLessThan(5); // Within 5 Hz accuracy
  });
});

describe('Full Round-Trip Encoding and Decoding (Text -> Sound -> Text)', () => {
  it('successfully transmits and decodes ASCII text at 48.0 kHz (Balanced Profile)', () => {
    const message = 'UltraLink 2026';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 101);
    expect(audio.length).toBeGreaterThan(0);

    const decoded = decodeAudioSamples(audio, sampleRate, { profile });
    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(message);
    expect(decoded[0].messageId).toBe(101);
    expect(decoded[0].crcPassed).toBe(true);
  });

  it('successfully transmits and decodes at 44.1 kHz sample rate (Dual Sample Rate Invariance)', () => {
    const message = 'SampleRate 44100Hz';
    const profile = PROFILES.balanced;
    const sampleRate = 44100;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 202);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(message);
    expect(decoded[0].messageId).toBe(202);
  });

  it('preserves Multilingual Unicode characters (Japanese, Arabic, Cyrillic)', () => {
    const message = 'こんにちは世界 — مرحباً — Привет';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 303);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(message);
  });

  it('preserves multi-byte UTF-8 emojis (Satellite, Rocket, Sparkles, Fire)', () => {
    const message = '🛰️ UltraLink 🚀 Acoustic ✨ Fire 🔥';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 404);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(message);
  });
});

describe('All 4 Operational Modulation Profiles', () => {
  it('decodes Reliable Profile (4-FSK)', () => {
    const message = 'Reliable 4FSK';
    const profile = PROFILES.reliable;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 501);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(message);
    expect(decoded[0].profileId).toBe('reliable');
  });

  it('decodes Fast Profile (16-FSK nibble mode)', () => {
    const message = 'Fast 16FSK Mode';
    const profile = PROFILES.fast;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 502);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(message);
    expect(decoded[0].profileId).toBe('fast');
  });

  it('decodes Experimental Profile (Dual-Tone 8-FSK parallel band)', () => {
    const message = 'DualTone 8FSK';
    const profile = PROFILES.experimental;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 503);
    const decoded = decodeAudioSamples(audio, sampleRate, { profile });

    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(message);
    expect(decoded[0].profileId).toBe('experimental');
  });
});

describe('Pure TypeScript WAV File Export and Import Roundtrip', () => {
  it('encodes message to WAV byte array and decodes it back cleanly', () => {
    const originalText = 'UltraLink Offline WAV Codec Test 2026';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    // 1. Generate standalone WAV file bytes
    const wavBytes = encodeTextToWav(originalText, profile, sampleRate);
    expect(wavBytes.length).toBeGreaterThan(44);

    // 2. Decode messages directly from WAV file bytes
    const decoded = decodeWavToMessages(wavBytes, { profile });
    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(originalText);
    expect(decoded[0].crcPassed).toBe(true);
  });
});

describe('Noise Tolerance and Doppler Shift Hardening', () => {
  it('correctly decodes in presence of moderate Additive White Gaussian Noise (AWGN)', () => {
    const message = 'Noise Immune';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 601);

    // Inject pseudo-random noise (~18 dB SNR)
    const noisyAudio = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i++) {
      const noise = (Math.random() - 0.5) * 0.08;
      noisyAudio[i] = audio[i] + noise;
    }

    const decoded = decodeAudioSamples(noisyAudio, sampleRate, { profile });
    expect(decoded.length).toBe(1);
    expect(decoded[0].text).toBe(message);
  });

  it('rejects heavily corrupted audio without returning bogus text', () => {
    const message = 'Secret Passcode';
    const profile = PROFILES.balanced;
    const sampleRate = 48000;

    const audio = encodeTextToAudioBuffer(message, profile, sampleRate, 701);

    // Erase six complete payload symbols while preserving Barker sync,
    // the header and its CRC. This guarantees that payload bytes differ
    // rather than relying on random noise which might leave tone decisions
    // unchanged after the receiver's narrow-band integration.
    const corruptedAudio = new Float32Array(audio);
    const symbolSamples = Math.round(profile.symbolDurationMs * sampleRate / 1000);
    const headerSymbols = Math.ceil(8 * 8 / profile.bitsPerSymbol);
    const dataStart = Math.round(
      (profile.chirpDurationMs + 13 * 5 + 10) * sampleRate / 1000
    );
    const payloadSymbolStart = dataStart + (headerSymbols + 2) * symbolSamples;
    corruptedAudio.fill(0, payloadSymbolStart, payloadSymbolStart + 6 * symbolSamples);

    const decoded = decodeAudioSamples(corruptedAudio, sampleRate, { profile });
    // Erased payload changes must be rejected rather than emitted as text.
    expect(decoded.length).toBe(0);
  });
});
