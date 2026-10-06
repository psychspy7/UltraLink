/**
 * UltraLink Modulation Engine
 * Continuous Phase Frequency Shift Keying (CP-FSK / MFSK)
 * Tone synthesis in 17.0–19.0 kHz range with Tukey cosine windowing
 * to prevent audible key-clicks and spectral splatter.
 */

import {
  BARKER_13_BITS,
  Packet,
  chunkText,
  serializePacket,
} from './framing';
import { ModulationProfile, DEFAULT_PROFILE } from './profiles';

/**
 * Maps raw byte buffer to an array of symbol integers for a given profile
 */
export function bytesToSymbols(bytes: Uint8Array, profile: ModulationProfile): number[] {
  const symbols: number[] = [];

  switch (profile.scheme) {
    case '4-fsk': {
      // 2 bits per symbol (4 symbols per byte: bits 7-6, 5-4, 3-2, 1-0)
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        symbols.push((b >> 6) & 0x03);
        symbols.push((b >> 4) & 0x03);
        symbols.push((b >> 2) & 0x03);
        symbols.push(b & 0x03);
      }
      break;
    }

    case '8-fsk': {
      // 3 bits per symbol: pack bitstream MSB first
      let bitBuffer = 0;
      let bitCount = 0;
      for (let i = 0; i < bytes.length; i++) {
        bitBuffer = ((bitBuffer << 8) | bytes[i]) >>> 0;
        bitCount += 8;
        while (bitCount >= 3) {
          bitCount -= 3;
          symbols.push((bitBuffer >> bitCount) & 0x07);
          bitBuffer = bitBuffer & ((1 << bitCount) - 1);
        }
      }
      if (bitCount > 0) {
        // Pad remaining bits with zeros to form 3-bit symbol
        symbols.push((bitBuffer << (3 - bitCount)) & 0x07);
      }
      break;
    }

    case '16-fsk': {
      // 4 bits per symbol (2 symbols per byte: high nibble then low nibble)
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        symbols.push((b >> 4) & 0x0f);
        symbols.push(b & 0x0f);
      }
      break;
    }

    case 'dual-8fsk': {
      // 6 bits per symbol (3 bits Band A [0..7], 3 bits Band B [0..7])
      let bitBuffer = 0;
      let bitCount = 0;
      for (let i = 0; i < bytes.length; i++) {
        bitBuffer = ((bitBuffer << 8) | bytes[i]) >>> 0;
        bitCount += 8;
        while (bitCount >= 6) {
          bitCount -= 6;
          symbols.push((bitBuffer >> bitCount) & 0x3f);
          bitBuffer = bitBuffer & ((1 << bitCount) - 1);
        }
      }
      if (bitCount > 0) {
        symbols.push((bitBuffer << (6 - bitCount)) & 0x3f);
      }
      break;
    }
  }

  return symbols;
}

/**
 * Reconstructs raw byte array from symbol integers
 */
export function symbolsToBytes(
  symbols: number[],
  profile: ModulationProfile,
  expectedByteLength: number
): Uint8Array {
  const out = new Uint8Array(expectedByteLength);
  let byteIndex = 0;

  switch (profile.scheme) {
    case '4-fsk': {
      for (let i = 0; i < symbols.length && byteIndex < expectedByteLength; i += 4) {
        const s0 = symbols[i] || 0;
        const s1 = symbols[i + 1] || 0;
        const s2 = symbols[i + 2] || 0;
        const s3 = symbols[i + 3] || 0;
        out[byteIndex++] = ((s0 & 0x03) << 6) | ((s1 & 0x03) << 4) | ((s2 & 0x03) << 2) | (s3 & 0x03);
      }
      break;
    }

    case '8-fsk': {
      let bitBuffer = 0;
      let bitCount = 0;
      for (let i = 0; i < symbols.length && byteIndex < expectedByteLength; i++) {
        bitBuffer = ((bitBuffer << 3) | (symbols[i] & 0x07)) >>> 0;
        bitCount += 3;
        while (bitCount >= 8 && byteIndex < expectedByteLength) {
          bitCount -= 8;
          out[byteIndex++] = (bitBuffer >> bitCount) & 0xff;
          bitBuffer = bitBuffer & ((1 << bitCount) - 1);
        }
      }
      break;
    }

    case '16-fsk': {
      for (let i = 0; i < symbols.length && byteIndex < expectedByteLength; i += 2) {
        const high = symbols[i] || 0;
        const low = symbols[i + 1] || 0;
        out[byteIndex++] = ((high & 0x0f) << 4) | (low & 0x0f);
      }
      break;
    }

    case 'dual-8fsk': {
      let bitBuffer = 0;
      let bitCount = 0;
      for (let i = 0; i < symbols.length && byteIndex < expectedByteLength; i++) {
        bitBuffer = ((bitBuffer << 6) | (symbols[i] & 0x3f)) >>> 0;
        bitCount += 6;
        while (bitCount >= 8 && byteIndex < expectedByteLength) {
          bitCount -= 8;
          out[byteIndex++] = (bitBuffer >> bitCount) & 0xff;
          bitBuffer = bitBuffer & ((1 << bitCount) - 1);
        }
      }
      break;
    }
  }

  return out;
}

/**
 * Continuous Phase CP-FSK Modulator
 */
export class ContinuousPhaseModulator {
  private phase = 0;
  private phaseB = 0; // For dual-tone mode

  /**
   * Reset phase accumulators
   */
  public reset(): void {
    this.phase = 0;
    this.phaseB = 0;
  }

  /**
   * Synthesize a linear chirp sweep with smooth cosine windowing
   */
  public synthesizeChirp(
    startFreq: number,
    endFreq: number,
    durationMs: number,
    sampleRate: number,
    amplitude = 0.8
  ): Float32Array {
    const numSamples = Math.round((durationMs / 1000) * sampleRate);
    const out = new Float32Array(numSamples);
    const T = durationMs / 1000;
    const rampSamples = Math.round(0.005 * sampleRate); // 5ms ramp

    for (let n = 0; n < numSamples; n++) {
      const t = n / sampleRate;
      // Linear frequency sweep: f(t) = f0 + (f1 - f0)/T * t
      // Instantaneous phase: phi(t) = 2*pi*(f0*t + (f1-f0)/(2*T) * t^2)
      const instantaneousPhase = 2 * Math.PI * (startFreq * t + ((endFreq - startFreq) / (2 * T)) * t * t);

      // Windowing (Tukey cosine ramp)
      let env = 1.0;
      if (n < rampSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * n) / rampSamples));
      } else if (n > numSamples - rampSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * (numSamples - n)) / rampSamples));
      }

      out[n] = amplitude * env * Math.sin(instantaneousPhase + this.phase);
    }

    // Keep ending phase
    const endT = numSamples / sampleRate;
    const finalPhase = 2 * Math.PI * (startFreq * endT + ((endFreq - startFreq) / (2 * T)) * endT * endT);
    this.phase = (this.phase + finalPhase) % (2 * Math.PI);

    return out;
  }

  /**
   * Synthesize Barker-13 sync word using pilot frequencies
   */
  public synthesizeBarkerSync(
    profile: ModulationProfile,
    sampleRate: number,
    chipDurationMs = 5,
    amplitude = 0.8
  ): Float32Array {
    const chipSamples = Math.round((chipDurationMs / 1000) * sampleRate);
    const totalSamples = chipSamples * BARKER_13_BITS.length;
    const out = new Float32Array(totalSamples);

    const f0 = profile.pilotFrequencies[0];
    const f1 = profile.pilotFrequencies[1] || profile.pilotFrequencies[0] + 1500;
    const rampSamples = Math.max(2, Math.round(0.001 * sampleRate)); // 1ms ramp

    let offset = 0;
    for (let c = 0; c < BARKER_13_BITS.length; c++) {
      const bit = BARKER_13_BITS[c];
      const freq = bit === 1 ? f1 : f0;
      const phaseInc = (2 * Math.PI * freq) / sampleRate;

      for (let n = 0; n < chipSamples; n++) {
        this.phase = (this.phase + phaseInc) % (2 * Math.PI);

        // Cosine window per chip
        let env = 1.0;
        if (n < rampSamples) {
          env = 0.5 * (1 - Math.cos((Math.PI * n) / rampSamples));
        } else if (n > chipSamples - rampSamples) {
          env = 0.5 * (1 - Math.cos((Math.PI * (chipSamples - n)) / rampSamples));
        }

        out[offset++] = amplitude * env * Math.sin(this.phase);
      }
    }

    return out;
  }

  /**
   * Synthesize a single active tone with Tukey window + guard interval
   */
  public synthesizeSymbolTone(
    freq: number,
    activeDurationMs: number,
    guardDurationMs: number,
    rampDurationMs: number,
    sampleRate: number,
    amplitude = 0.8
  ): Float32Array {
    const activeSamples = Math.round((activeDurationMs / 1000) * sampleRate);
    const guardSamples = Math.round((guardDurationMs / 1000) * sampleRate);
    const totalSamples = activeSamples + guardSamples;
    const rampSamples = Math.round((rampDurationMs / 1000) * sampleRate);

    const out = new Float32Array(totalSamples);
    const phaseInc = (2 * Math.PI * freq) / sampleRate;

    for (let n = 0; n < activeSamples; n++) {
      this.phase = (this.phase + phaseInc) % (2 * Math.PI);

      let env = 1.0;
      if (n < rampSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * n) / rampSamples));
      } else if (n > activeSamples - rampSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * (activeSamples - n)) / rampSamples));
      }

      out[n] = amplitude * env * Math.sin(this.phase);
    }

    // Guard samples remain 0.0 (silent decay)
    return out;
  }

  /**
   * Synthesize dual tone (Experimental profile: 2 simultaneous tones)
   */
  public synthesizeDualSymbolTone(
    freqA: number,
    freqB: number,
    activeDurationMs: number,
    guardDurationMs: number,
    rampDurationMs: number,
    sampleRate: number,
    amplitude = 0.8
  ): Float32Array {
    const activeSamples = Math.round((activeDurationMs / 1000) * sampleRate);
    const guardSamples = Math.round((guardDurationMs / 1000) * sampleRate);
    const totalSamples = activeSamples + guardSamples;
    const rampSamples = Math.round((rampDurationMs / 1000) * sampleRate);

    const out = new Float32Array(totalSamples);
    const phaseIncA = (2 * Math.PI * freqA) / sampleRate;
    const phaseIncB = (2 * Math.PI * freqB) / sampleRate;

    for (let n = 0; n < activeSamples; n++) {
      this.phase = (this.phase + phaseIncA) % (2 * Math.PI);
      this.phaseB = (this.phaseB + phaseIncB) % (2 * Math.PI);

      let env = 1.0;
      if (n < rampSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * n) / rampSamples));
      } else if (n > activeSamples - rampSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * (activeSamples - n)) / rampSamples));
      }

      // Sum equal power tones (divided by 2 to prevent clipping)
      const sample = 0.5 * Math.sin(this.phase) + 0.5 * Math.sin(this.phaseB);
      out[n] = amplitude * env * sample;
    }

    return out;
  }

  /**
   * Modulate a complete serialized packet into audio samples
   */
  public modulatePacket(
    packet: Packet,
    profile: ModulationProfile,
    sampleRate: number
  ): Float32Array {
    const serialized = serializePacket(packet);
    const symbols = bytesToSymbols(serialized, profile);

    // 1. Preamble Chirp
    const chirp = this.synthesizeChirp(
      profile.chirpStartFreq,
      profile.chirpEndFreq,
      profile.chirpDurationMs,
      sampleRate
    );

    // 2. Barker-13 Sync sequence
    const sync = this.synthesizeBarkerSync(profile, sampleRate, 5);

    // 3. Pre-data guard (10ms silence)
    const guardSamples = Math.round(0.01 * sampleRate);
    const preDataGuard = new Float32Array(guardSamples);

    // 4. Data Symbols
    const symbolBuffers: Float32Array[] = [];
    let totalSymbolSamples = 0;

    for (const sym of symbols) {
      let symBuf: Float32Array;

      if (profile.scheme === 'dual-8fsk' && profile.dualBandFrequencies) {
        const symA = sym & 0x07;
        const symB = (sym >> 3) & 0x07;
        const freqA = profile.dualBandFrequencies.bandA[symA];
        const freqB = profile.dualBandFrequencies.bandB[symB];
        symBuf = this.synthesizeDualSymbolTone(
          freqA,
          freqB,
          profile.activeDurationMs,
          profile.guardDurationMs,
          profile.rampDurationMs,
          sampleRate
        );
      } else {
        const freq = profile.dataFrequencies[sym];
        symBuf = this.synthesizeSymbolTone(
          freq,
          profile.activeDurationMs,
          profile.guardDurationMs,
          profile.rampDurationMs,
          sampleRate
        );
      }

      symbolBuffers.push(symBuf);
      totalSymbolSamples += symBuf.length;
    }

    // 5. Postamble guard (20ms silence)
    const postambleSamples = Math.round(0.02 * sampleRate);
    const postamble = new Float32Array(postambleSamples);

    // Assemble complete waveform
    const totalLength =
      chirp.length + sync.length + preDataGuard.length + totalSymbolSamples + postamble.length;
    const result = new Float32Array(totalLength);

    let offset = 0;
    result.set(chirp, offset);
    offset += chirp.length;

    result.set(sync, offset);
    offset += sync.length;

    result.set(preDataGuard, offset);
    offset += preDataGuard.length;

    for (const symBuf of symbolBuffers) {
      result.set(symBuf, offset);
      offset += symBuf.length;
    }

    result.set(postamble, offset);

    return result;
  }
}

/**
 * Top-level convenience function: encode text into audio sample buffer Float32Array
 */
export function encodeTextToAudioBuffer(
  text: string,
  profile: ModulationProfile = DEFAULT_PROFILE,
  sampleRate = 48000,
  customMessageId?: number
): Float32Array {
  const packets = chunkText(text, profile, customMessageId);
  const modulator = new ContinuousPhaseModulator();

  // Modulate all packets separated by 40ms inter-packet silence
  const packetBuffers: Float32Array[] = [];
  const interPacketSilence = new Float32Array(Math.round(0.04 * sampleRate));
  let totalLength = 0;

  for (let i = 0; i < packets.length; i++) {
    const buf = modulator.modulatePacket(packets[i], profile, sampleRate);
    packetBuffers.push(buf);
    totalLength += buf.length;
    if (i < packets.length - 1) {
      packetBuffers.push(interPacketSilence);
      totalLength += interPacketSilence.length;
    }
  }

  const output = new Float32Array(totalLength);
  let offset = 0;
  for (const buf of packetBuffers) {
    output.set(buf, offset);
    offset += buf.length;
  }

  return output;
}
