/**
 * UltraLink Core Audio DSP Engine
 * Near-ultrasonic physical layer & Web Audio processing (17.0 kHz – 19.0 kHz)
 */

export * from './profiles';
export * from './crc';
export * from './framing';
export * from './modulation';
export * from './goertzel';
export * from './demodulation';
export * from './wav';

import { ModulationProfile } from './profiles';
import { DecodedMessage } from './framing';
import { encodeTextToAudioBuffer } from './modulation';
import { decodeAudioSamples, DemodulationOptions } from './demodulation';
import { encodeTextToWav, decodeWavBuffer } from './wav';

export interface DspEncoder {
  encodeTextToAudioBuffer(
    text: string,
    profile: ModulationProfile,
    sampleRate: number
  ): Float32Array;
  encodeTextToWav(
    text: string,
    profile: ModulationProfile,
    sampleRate: number
  ): Uint8Array;
}

export interface DspDecoder {
  decodeWavBuffer(
    wavBytes: Uint8Array,
    options?: DemodulationOptions
  ): Promise<DecodedMessage>;
  decodeAudioSamples(
    samples: Float32Array,
    sampleRate: number,
    options?: DemodulationOptions
  ): DecodedMessage[];
}

export const dspEncoder: DspEncoder = {
  encodeTextToAudioBuffer,
  encodeTextToWav,
};

export const dspDecoder: DspDecoder = {
  decodeWavBuffer,
  decodeAudioSamples,
};
