/**
 * UltraLink Demodulator & State Machine
 * Energy peak detection, Barker-13 sync correlation, AFC Doppler correction,
 * Goertzel symbol extraction, packet validation, and message reassembly.
 */

import { computeCrc8, verifyCrc8, verifyCrc32 } from './crc';
import {
  BARKER_13_BITS,
  DecodedMessage,
  Packet,
  PacketHeader,
  PacketReassembler,
  deserializeHeader,
  deserializePacket,
} from './framing';
import { GoertzelFilterBank } from './goertzel';
import { symbolsToBytes } from './modulation';
import {
  ModulationProfile,
  PROFILES,
  DEFAULT_PROFILE,
  getProfile,
  getProfileByNumericId,
} from './profiles';

export interface DemodulationOptions {
  profile?: ModulationProfile;
  sampleRate?: number;
  snrThresholdDb?: number;
  enableAfc?: boolean;
}

export interface DemodulationResult {
  packets: Packet[];
  messages: DecodedMessage[];
  averageSnrDb: number;
}

export interface DemodulatorCallbacks {
  onSyncDetected?: (confidence: number, carrierOffsetHz: number) => void;
  onPacketDecoded?: (packet: Packet, snrDb: number) => void;
  onMessageDecoded?: (message: DecodedMessage) => void;
  onCrcError?: (expected: number, actual: number) => void;
  onSpectrum?: (powers: number[], peakFreq: number) => void;
}

/**
 * Streaming / Block Demodulator for UltraLink acoustic signals
 */
export class Demodulator {
  private profile: ModulationProfile;
  private sampleRate: number;
  private snrThresholdDb: number;
  private enableAfc: boolean;
  private filterBank: GoertzelFilterBank;
  private bandAFilterBank?: GoertzelFilterBank; // For dual-tone experimental profile
  private bandBFilterBank?: GoertzelFilterBank;
  private reassembler = new PacketReassembler();
  private callbacks: DemodulatorCallbacks = {};

  constructor(options: DemodulationOptions = {}, callbacks: DemodulatorCallbacks = {}) {
    this.profile = options.profile || DEFAULT_PROFILE;
    this.sampleRate = options.sampleRate || 48000;
    this.snrThresholdDb = options.snrThresholdDb ?? this.profile.snrThresholdDb;
    this.enableAfc = options.enableAfc ?? true;
    this.callbacks = callbacks;

    this.filterBank = new GoertzelFilterBank(this.profile.dataFrequencies, this.sampleRate);
    this.setupDualBands();
  }

  public setProfile(profile: ModulationProfile): void {
    this.profile = profile;
    this.snrThresholdDb = profile.snrThresholdDb;
    this.filterBank = new GoertzelFilterBank(profile.dataFrequencies, this.sampleRate);
    this.setupDualBands();
  }

  public setSampleRate(sampleRate: number): void {
    this.sampleRate = sampleRate;
    this.filterBank.setSampleRate(sampleRate);
    if (this.bandAFilterBank) this.bandAFilterBank.setSampleRate(sampleRate);
    if (this.bandBFilterBank) this.bandBFilterBank.setSampleRate(sampleRate);
  }

  public setCallbacks(callbacks: DemodulatorCallbacks): void {
    this.callbacks = callbacks;
  }

  public reset(): void {
    this.reassembler.reset();
    this.filterBank.setCarrierOffset(0);
    if (this.bandAFilterBank) this.bandAFilterBank.setCarrierOffset(0);
    if (this.bandBFilterBank) this.bandBFilterBank.setCarrierOffset(0);
  }

  private setupDualBands(): void {
    if (this.profile.scheme === 'dual-8fsk' && this.profile.dualBandFrequencies) {
      this.bandAFilterBank = new GoertzelFilterBank(
        this.profile.dualBandFrequencies.bandA,
        this.sampleRate
      );
      this.bandBFilterBank = new GoertzelFilterBank(
        this.profile.dualBandFrequencies.bandB,
        this.sampleRate
      );
    } else {
      this.bandAFilterBank = undefined;
      this.bandBFilterBank = undefined;
    }
  }

  /**
   * Process a complete audio sample buffer and extract all decoded messages
   */
  public decodeBuffer(samples: Float32Array): DemodulationResult {
    const packets: Packet[] = [];
    const messages: DecodedMessage[] = [];
    let totalSnr = 0;
    let snrCount = 0;

    const chipSamples = Math.round((5 / 1000) * this.sampleRate);
    const barkerTotalSamples = chipSamples * BARKER_13_BITS.length;
    const f0 = this.profile.pilotFrequencies[0];
    const f1 = this.profile.pilotFrequencies[1] || f0 + 1500;

    let scanIdx = 0;
    const endScan = samples.length - barkerTotalSamples;

    while (scanIdx < endScan) {
      // Step 1: Rapid coarse energy check in pilot frequency band
      const coarseP0 = GoertzelFilterBank.computeSingleFrequencyPower(
        f0,
        samples,
        this.sampleRate,
        scanIdx,
        chipSamples
      );
      const coarseP1 = GoertzelFilterBank.computeSingleFrequencyPower(
        f1,
        samples,
        this.sampleRate,
        scanIdx,
        chipSamples
      );

      // If neither pilot frequency has significant power, step forward rapidly
      if (coarseP0 < 1e-6 && coarseP1 < 1e-6) {
        scanIdx += Math.max(1, Math.floor(chipSamples / 2));
        continue;
      }

      // Step 2: Check for Barker-13 correlation over 13 chips
      let matchScore = 0;
      for (let c = 0; c < BARKER_13_BITS.length; c++) {
        const cOffset = scanIdx + c * chipSamples;
        const p0 = GoertzelFilterBank.computeSingleFrequencyPower(
          f0,
          samples,
          this.sampleRate,
          cOffset,
          chipSamples
        );
        const p1 = GoertzelFilterBank.computeSingleFrequencyPower(
          f1,
          samples,
          this.sampleRate,
          cOffset,
          chipSamples
        );

        const expectedBit = BARKER_13_BITS[c];
        if (expectedBit === 1 && p1 > p0) matchScore++;
        else if (expectedBit === 0 && p0 > p1) matchScore++;
      }

      // Strong Barker correlation threshold: at least 11 out of 13 chips matching
      if (matchScore >= 11) {
        // Refine synchronization boundary within +/- 1 chip window
        let bestScore = matchScore;
        let bestOffset = scanIdx;
        const fineSearchStart = Math.max(0, scanIdx - chipSamples);
        const fineSearchEnd = Math.min(endScan, scanIdx + chipSamples);
        const fineStep = Math.max(1, Math.floor(this.sampleRate / 4000)); // ~10-12 samples step

        for (let fineIdx = fineSearchStart; fineIdx <= fineSearchEnd; fineIdx += fineStep) {
          let score = 0;
          for (let c = 0; c < BARKER_13_BITS.length; c++) {
            const cOffset = fineIdx + c * chipSamples;
            const p0 = GoertzelFilterBank.computeSingleFrequencyPower(
              f0,
              samples,
              this.sampleRate,
              cOffset,
              chipSamples
            );
            const p1 = GoertzelFilterBank.computeSingleFrequencyPower(
              f1,
              samples,
              this.sampleRate,
              cOffset,
              chipSamples
            );
            const bit = BARKER_13_BITS[c];
            if (bit === 1 && p1 > p0) score++;
            else if (bit === 0 && p0 > p1) score++;
          }
          if (score > bestScore) {
            bestScore = score;
            bestOffset = fineIdx;
          }
        }

        const syncStart = bestOffset;
        const syncEnd = syncStart + barkerTotalSamples;

        // Step 3: Automatic Frequency Control (AFC) Carrier Offset Estimation
        let carrierOffset = 0;
        if (this.enableAfc) {
          // Measure refined peak frequency on first bit=1 chip (chip 0 is bit 1)
          const refinedF1 = this.filterBank.refinePeakFrequency(
            samples,
            f1,
            50,
            syncStart,
            chipSamples
          );
          carrierOffset = refinedF1 - f1;
          // Bound AFC offset to +/- 120 Hz
          carrierOffset = Math.max(-120, Math.min(120, carrierOffset));
        }

        this.filterBank.setCarrierOffset(carrierOffset);
        if (this.bandAFilterBank) this.bandAFilterBank.setCarrierOffset(carrierOffset);
        if (this.bandBFilterBank) this.bandBFilterBank.setCarrierOffset(carrierOffset);

        if (this.callbacks.onSyncDetected) {
          this.callbacks.onSyncDetected(bestScore / 13, carrierOffset);
        }

        // Step 4: Demodulate Packet Data
        // Position immediately after Barker sequence + 10ms preDataGuard
        const preDataGuardSamples = Math.round(0.01 * this.sampleRate);
        const dataStartOffset = syncEnd + preDataGuardSamples;

        const packetResult = this.demodulatePacketAt(samples, dataStartOffset);
        if (packetResult) {
          packets.push(packetResult.packet);
          totalSnr += packetResult.snrDb;
          snrCount++;

          if (this.callbacks.onPacketDecoded) {
            this.callbacks.onPacketDecoded(packetResult.packet, packetResult.snrDb);
          }

          // Feed into reassembler
          const completedMsg = this.reassembler.addPacket(
            packetResult.packet,
            packetResult.snrDb
          );
          if (completedMsg) {
            completedMsg.sampleRate = this.sampleRate;
            completedMsg.durationMs = Math.round((samples.length / this.sampleRate) * 1000);
            messages.push(completedMsg);
            if (this.callbacks.onMessageDecoded) {
              this.callbacks.onMessageDecoded(completedMsg);
            }
          }

          // Advance past the demodulated packet
          scanIdx = dataStartOffset + packetResult.samplesConsumed;
          continue;
        } else {
          // Sync false-trigger or corrupted header: advance past this sync
          scanIdx = syncEnd + preDataGuardSamples;
          continue;
        }
      }

      // No match at current index, advance by coarse step
      scanIdx += Math.max(1, Math.floor(chipSamples / 3));
    }

    return {
      packets,
      messages,
      averageSnrDb: snrCount > 0 ? totalSnr / snrCount : 0,
    };
  }

  /**
   * Demodulate symbols of a single packet beginning at dataStartOffset
   */
  private demodulatePacketAt(
    samples: Float32Array,
    dataStartOffset: number
  ): { packet: Packet; snrDb: number; samplesConsumed: number } | null {
    const activeSamples = Math.round((this.profile.activeDurationMs / 1000) * this.sampleRate);
    const guardSamples = Math.round((this.profile.guardDurationMs / 1000) * this.sampleRate);
    const symTotalSamples = activeSamples + guardSamples;

    // Use center 70% of active duration for power integration (avoid ramps and guard)
    const windowOffset = Math.round(0.15 * activeSamples);
    const windowLength = Math.max(8, Math.round(0.7 * activeSamples));

    // Number of symbols needed for 8-byte header
    const headerSymbolCount = this.calculateSymbolsForBytes(8, this.profile);
    const headerSymbols: number[] = [];
    let snrAccumulator = 0;

    let currentSampleOffset = dataStartOffset;

    for (let s = 0; s < headerSymbolCount; s++) {
      if (currentSampleOffset + activeSamples > samples.length) {
        return null; // Buffer exhausted before header complete
      }

      const symVal = this.demodulateSingleSymbol(
        samples,
        currentSampleOffset + windowOffset,
        windowLength
      );

      headerSymbols.push(symVal.symbol);
      snrAccumulator += symVal.snrDb;
      currentSampleOffset += symTotalSamples;
    }

    // Unpack 8 header bytes and verify CRC8
    const headerBytes = symbolsToBytes(headerSymbols, this.profile, 8);
    const header = deserializeHeader(headerBytes);
    if (!header) {
      if (this.callbacks.onCrcError) {
        this.callbacks.onCrcError(0, headerBytes[7]);
      }
      return null; // Header CRC8 mismatch
    }

    // Header verified! Calculate remaining symbols needed for payload + 4-byte CRC32
    const totalPacketBytes = 8 + header.payloadLength + 4;
    const totalSymbolCount = this.calculateSymbolsForBytes(totalPacketBytes, this.profile);
    const allSymbols = [...headerSymbols];

    for (let s = headerSymbolCount; s < totalSymbolCount; s++) {
      if (currentSampleOffset + activeSamples > samples.length) {
        return null; // Buffer truncated
      }

      const symVal = this.demodulateSingleSymbol(
        samples,
        currentSampleOffset + windowOffset,
        windowLength
      );

      allSymbols.push(symVal.symbol);
      snrAccumulator += symVal.snrDb;
      currentSampleOffset += symTotalSamples;
    }

    // Reconstruct full packet bytes and verify CRC32
    const fullPacketBytes = symbolsToBytes(allSymbols, this.profile, totalPacketBytes);
    const packet = deserializePacket(fullPacketBytes);
    if (!packet) {
      if (this.callbacks.onCrcError) {
        this.callbacks.onCrcError(0, 1);
      }
      return null; // Payload CRC32 mismatch
    }

    const avgSnr = totalSymbolCount > 0 ? snrAccumulator / totalSymbolCount : 0;
    const samplesConsumed = currentSampleOffset - dataStartOffset;

    return {
      packet,
      snrDb: avgSnr,
      samplesConsumed,
    };
  }

  private calculateSymbolsForBytes(numBytes: number, profile: ModulationProfile): number {
    switch (profile.scheme) {
      case '4-fsk':
        return numBytes * 4;
      case '8-fsk':
        return Math.ceil((numBytes * 8) / 3);
      case '16-fsk':
        return numBytes * 2;
      case 'dual-8fsk':
        return Math.ceil((numBytes * 8) / 6);
    }
  }

  private demodulateSingleSymbol(
    samples: Float32Array,
    offset: number,
    length: number
  ): { symbol: number; snrDb: number } {
    if (this.profile.scheme === 'dual-8fsk' && this.bandAFilterBank && this.bandBFilterBank) {
      const resA = this.bandAFilterBank.evaluate(samples, offset, length);
      const resB = this.bandBFilterBank.evaluate(samples, offset, length);
      const symA = resA.peakIndex & 0x07;
      const symB = resB.peakIndex & 0x07;
      const combinedSymbol = symA | (symB << 3);
      const snr = (resA.snrDb + resB.snrDb) / 2;

      if (this.callbacks.onSpectrum) {
        this.callbacks.onSpectrum([...resA.powers, ...resB.powers], resA.peakFrequency);
      }

      return { symbol: combinedSymbol, snrDb: snr };
    }

    const res = this.filterBank.evaluate(samples, offset, length);
    if (this.callbacks.onSpectrum) {
      this.callbacks.onSpectrum(res.powers, res.peakFrequency);
    }

    return { symbol: res.peakIndex, snrDb: res.snrDb };
  }
}

/**
 * Top-level convenience function: decode raw audio sample buffer
 */
export function decodeAudioSamples(
  samples: Float32Array,
  sampleRate = 48000,
  options: DemodulationOptions = {}
): DecodedMessage[] {
  const profile = options.profile || DEFAULT_PROFILE;
  const demodulator = new Demodulator({
    profile,
    sampleRate,
    ...options,
  });

  const res = demodulator.decodeBuffer(samples);
  return res.messages;
}
