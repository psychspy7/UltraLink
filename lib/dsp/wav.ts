/**
 * UltraLink Pure TypeScript RIFF WAV Codec
 * 16-bit PCM Mono/Stereo WAV encoder and decoder
 * Zero native dependencies; runs identically in Node.js and browser environments.
 */

import { DecodedMessage } from './framing';
import { ModulationProfile, DEFAULT_PROFILE } from './profiles';
import { encodeTextToAudioBuffer } from './modulation';
import { DemodulationOptions, decodeAudioSamples } from './demodulation';

export interface DecodedWav {
  samples: Float32Array; // Mono normalized audio samples [-1.0, 1.0]
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  durationSeconds: number;
}

/**
 * Encode Float32Array samples into standard 16-bit PCM RIFF WAV byte array
 */
export function encodeWav(
  samples: Float32Array,
  sampleRate = 48000,
  numChannels = 1
): Uint8Array {
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // Helper to write ASCII 4-char string
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF Chunk Descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // ChunkSize
  writeString(8, 'WAVE');

  // "fmt " Sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);             // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);              // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);    // NumChannels
  view.setUint32(24, sampleRate, true);     // SampleRate
  view.setUint32(28, byteRate, true);       // ByteRate
  view.setUint16(32, blockAlign, true);     // BlockAlign
  view.setUint16(34, 16, true);             // BitsPerSample (16 bits)

  // "data" Sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);       // Subchunk2Size

  // Write 16-bit PCM samples with saturation clipping
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1.0, Math.min(1.0, samples[i]));
    const int16 = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Decode RIFF WAV byte array into normalized Float32Array samples
 * Supports PCM 8-bit, 16-bit, 24-bit, 32-bit int, and 32-bit float.
 * Automatically downmixes multi-channel audio to mono.
 */
export function decodeWav(wavBytes: Uint8Array): DecodedWav {
  if (wavBytes.length < 44) {
    throw new Error('Invalid WAV file: buffer too small to contain RIFF header');
  }

  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);

  // Check 'RIFF' header
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') {
    throw new Error(`Invalid WAV file: expected 'RIFF' magic but found '${riff}'`);
  }

  // Check 'WAVE' format
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== 'WAVE') {
    throw new Error(`Invalid WAV file: expected 'WAVE' format but found '${wave}'`);
  }

  let audioFormat = 1;
  let numChannels = 1;
  let sampleRate = 48000;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  // Scan RIFF chunks
  let pos = 12;
  while (pos + 8 <= wavBytes.length) {
    const chunkId = String.fromCharCode(
      view.getUint8(pos),
      view.getUint8(pos + 1),
      view.getUint8(pos + 2),
      view.getUint8(pos + 3)
    );
    const chunkSize = view.getUint32(pos + 4, true);

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(pos + 8, true);
      numChannels = view.getUint16(pos + 10, true);
      sampleRate = view.getUint32(pos + 12, true);
      bitsPerSample = view.getUint16(pos + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = pos + 8;
      dataSize = chunkSize;
      break;
    }

    pos += 8 + chunkSize;
  }

  if (dataOffset === -1) {
    throw new Error("Invalid WAV file: 'data' chunk not found");
  }

  // Handle case where chunkSize is larger than remaining bytes
  const availableBytes = Math.min(dataSize, wavBytes.length - dataOffset);
  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(availableBytes / (bytesPerSample * numChannels));

  const monoSamples = new Float32Array(totalSamples);
  let readPos = dataOffset;

  for (let i = 0; i < totalSamples; i++) {
    let channelSum = 0;

    for (let ch = 0; ch < numChannels; ch++) {
      let sample = 0;

      if (audioFormat === 1) {
        // PCM Integer
        if (bitsPerSample === 16) {
          sample = view.getInt16(readPos, true) / 32768.0;
        } else if (bitsPerSample === 8) {
          sample = (view.getUint8(readPos) - 128) / 128.0;
        } else if (bitsPerSample === 24) {
          const b0 = view.getUint8(readPos);
          const b1 = view.getUint8(readPos + 1);
          const b2 = view.getInt8(readPos + 2);
          const val = (b2 << 16) | (b1 << 8) | b0;
          sample = val / 8388608.0;
        } else if (bitsPerSample === 32) {
          sample = view.getInt32(readPos, true) / 2147483648.0;
        }
      } else if (audioFormat === 3) {
        // IEEE Float
        if (bitsPerSample === 32) {
          sample = view.getFloat32(readPos, true);
        }
      }

      channelSum += sample;
      readPos += bytesPerSample;
    }

    monoSamples[i] = channelSum / numChannels;
  }

  return {
    samples: monoSamples,
    sampleRate,
    numChannels,
    bitsPerSample,
    durationSeconds: totalSamples / sampleRate,
  };
}

/**
 * Convenience helper: Encodes text into a downloadable WAV file byte array
 */
export function encodeTextToWav(
  text: string,
  profile: ModulationProfile = DEFAULT_PROFILE,
  sampleRate = 48000
): Uint8Array {
  const audioBuffer = encodeTextToAudioBuffer(text, profile, sampleRate);
  return encodeWav(audioBuffer, sampleRate, 1);
}

/**
 * Convenience helper: Decodes a WAV file buffer into decoded messages
 */
export function decodeWavToMessages(
  wavBytes: Uint8Array,
  options?: DemodulationOptions
): DecodedMessage[] {
  const wav = decodeWav(wavBytes);
  return decodeAudioSamples(wav.samples, wav.sampleRate, {
    sampleRate: wav.sampleRate,
    ...options,
  });
}

/**
 * Interface contract matching PROJECT.md DspDecoder.decodeWavBuffer
 */
export async function decodeWavBuffer(
  wavBytes: Uint8Array,
  options?: DemodulationOptions
): Promise<DecodedMessage> {
  const messages = decodeWavToMessages(wavBytes, options);
  if (messages.length === 0) {
    throw new Error('No valid UltraLink messages could be decoded from WAV buffer');
  }
  return messages[0];
}
