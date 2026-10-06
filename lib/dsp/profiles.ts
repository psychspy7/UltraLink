/**
 * UltraLink Acoustic Modulation Profiles
 * Near-ultrasonic physical layer configurations (17.0 kHz – 19.0 kHz)
 */

export type ProfileId = 'reliable' | 'balanced' | 'fast' | 'experimental';
export type ModulationScheme = '4-fsk' | '8-fsk' | '16-fsk' | 'dual-8fsk';

export interface ModulationProfile {
  id: ProfileId;
  numericId: number;
  name: string;
  description: string;
  scheme: ModulationScheme;
  baseFreq: number; // Hz
  freqSpacing: number; // Hz
  toneCount: number;
  dataFrequencies: number[];
  dualBandFrequencies?: { bandA: number[]; bandB: number[] };
  pilotFrequencies: number[];
  chirpStartFreq: number;
  chirpEndFreq: number;
  chirpDurationMs: number;
  symbolDurationMs: number; // Total symbol duration (active + guard)
  activeDurationMs: number;
  guardDurationMs: number;
  rampDurationMs: number; // Tukey cosine ramp duration
  bitsPerSymbol: number;
  maxPayloadBytes: number;
  snrThresholdDb: number;
  bandwidthHz: number;
  nominalBitrateBps: number;
}

export const PROFILES: Record<ProfileId, ModulationProfile> = {
  reliable: {
    id: 'reliable',
    numericId: 0,
    name: 'Reliable',
    description: '4-FSK robust mode with high noise margin (1-3m+ range, high ambient noise)',
    scheme: '4-fsk',
    baseFreq: 17200,
    freqSpacing: 250,
    toneCount: 4,
    dataFrequencies: [17300, 17550, 17800, 18050],
    pilotFrequencies: [17000, 18500],
    chirpStartFreq: 17000,
    chirpEndFreq: 18500,
    chirpDurationMs: 80,
    symbolDurationMs: 65,
    activeDurationMs: 50,
    guardDurationMs: 15,
    rampDurationMs: 4.0,
    bitsPerSymbol: 2,
    maxPayloadBytes: 16,
    snrThresholdDb: 4.5,
    bandwidthHz: 1050,
    nominalBitrateBps: 30.8,
  },
  balanced: {
    id: 'balanced',
    numericId: 1,
    name: 'Balanced',
    description: '8-FSK standard mode (default, indoor room 1-3m, optimal throughput)',
    scheme: '8-fsk',
    baseFreq: 17100,
    freqSpacing: 150,
    toneCount: 8,
    dataFrequencies: [17200, 17350, 17500, 17650, 17800, 17950, 18100, 18250],
    pilotFrequencies: [17000, 18700],
    chirpStartFreq: 17000,
    chirpEndFreq: 18700,
    chirpDurationMs: 60,
    symbolDurationMs: 40,
    activeDurationMs: 32,
    guardDurationMs: 8,
    rampDurationMs: 3.0,
    bitsPerSymbol: 3,
    maxPayloadBytes: 32,
    snrThresholdDb: 6.0,
    bandwidthHz: 1200,
    nominalBitrateBps: 75.0,
  },
  fast: {
    id: 'fast',
    numericId: 2,
    name: 'Fast',
    description: '16-FSK high-throughput mode (1 nibble/symbol, close proximity <1m)',
    scheme: '16-fsk',
    baseFreq: 17000,
    freqSpacing: 100,
    toneCount: 16,
    dataFrequencies: [
      17100, 17200, 17300, 17400, 17500, 17600, 17700, 17800,
      17900, 18000, 18100, 18200, 18300, 18400, 18500, 18600,
    ],
    pilotFrequencies: [18800, 19000],
    chirpStartFreq: 17000,
    chirpEndFreq: 18800,
    chirpDurationMs: 50,
    symbolDurationMs: 25,
    activeDurationMs: 20,
    guardDurationMs: 5,
    rampDurationMs: 2.5,
    bitsPerSymbol: 4,
    maxPayloadBytes: 48,
    snrThresholdDb: 7.5,
    bandwidthHz: 1600,
    nominalBitrateBps: 160.0,
  },
  experimental: {
    id: 'experimental',
    numericId: 3,
    name: 'Experimental',
    description: 'Dual-Tone 8-FSK parallel nibble transmission (high SNR lab testing)',
    scheme: 'dual-8fsk',
    baseFreq: 17100,
    freqSpacing: 100,
    toneCount: 16,
    dataFrequencies: [
      17100, 17200, 17300, 17400, 17500, 17600, 17700, 17800,
      18100, 18200, 18300, 18400, 18500, 18600, 18700, 18800,
    ],
    dualBandFrequencies: {
      bandA: [17100, 17200, 17300, 17400, 17500, 17600, 17700, 17800],
      bandB: [18100, 18200, 18300, 18400, 18500, 18600, 18700, 18800],
    },
    pilotFrequencies: [17000, 18900],
    chirpStartFreq: 17000,
    chirpEndFreq: 18900,
    chirpDurationMs: 50,
    symbolDurationMs: 25,
    activeDurationMs: 20,
    guardDurationMs: 5,
    rampDurationMs: 2.5,
    bitsPerSymbol: 6,
    maxPayloadBytes: 64,
    snrThresholdDb: 8.5,
    bandwidthHz: 1800,
    nominalBitrateBps: 240.0,
  },
};

export const DEFAULT_PROFILE = PROFILES.balanced;

export function getProfile(id: ProfileId): ModulationProfile {
  const profile = PROFILES[id];
  if (!profile) {
    throw new Error(`Unknown modulation profile id: ${id}`);
  }
  return profile;
}

export function getProfileByNumericId(numericId: number): ModulationProfile {
  switch (numericId) {
    case 0:
      return PROFILES.reliable;
    case 1:
      return PROFILES.balanced;
    case 2:
      return PROFILES.fast;
    case 3:
      return PROFILES.experimental;
    default:
      return PROFILES.balanced;
  }
}
