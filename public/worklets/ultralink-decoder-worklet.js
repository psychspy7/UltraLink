/**
 * UltraLink AudioWorkletProcessor
 * Runs on dedicated Web Audio real-time audio thread (AudioWorkletGlobalScope).
 * Performs incremental sample buffering, Goertzel filter bank evaluation,
 * Barker-13 sync detection, packet decoding, and spectrum telemetry.
 */

// CRC-8 Lookup Table (0x07)
const CRC8_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let curr = i;
  for (let j = 0; j < 8; j++) {
    if ((curr & 0x80) !== 0) {
      curr = ((curr << 1) ^ 0x07) & 0xff;
    } else {
      curr = (curr << 1) & 0xff;
    }
  }
  CRC8_TABLE[i] = curr;
}

// CRC-32 IEEE 802.3 Lookup Table (0xEDB88320)
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

function computeCrc8(data) {
  let crc = 0x00;
  for (let i = 0; i < data.length; i++) {
    crc = CRC8_TABLE[crc ^ data[i]];
  }
  return crc;
}

function computeCrc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const BARKER_13_BITS = [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1];
const MAGIC_BYTE = 0xd5;

class UltralinkDecoderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.sampleRate = 48000;
    this.profile = {
      id: 'balanced',
      numericId: 1,
      scheme: '8-fsk',
      dataFrequencies: [17200, 17350, 17500, 17650, 17800, 17950, 18100, 18250],
      pilotFrequencies: [17000, 18700],
      activeDurationMs: 32,
      guardDurationMs: 8,
      symbolDurationMs: 40,
      snrThresholdDb: 6.0,
      bitsPerSymbol: 3,
    };

    // Circular Ring Buffer (stores ~5.5 seconds of audio at 48kHz)
    this.ringBufferSize = 262144;
    this.ringBuffer = new Float32Array(this.ringBufferSize);
    this.linearWindow = new Float32Array(this.ringBufferSize);
    this.writePos = 0;
    this.readPos = 0;
    this.totalSamplesReceived = 0;

    // Carrier Offset (AFC)
    this.carrierOffset = 0;

    // Telemetry throttling
    this.spectrumFrameCounter = 0;

    // Pending packets reassembler
    this.pendingMessages = new Map();
    this.completedMessages = new Map();

    // Worklet Port communication
    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'SET_PROFILE' && data.profile) {
        this.profile = data.profile;
        this.reset();
      } else if (data.type === 'SET_SAMPLE_RATE' && data.sampleRate) {
        this.sampleRate = data.sampleRate;
        this.reset();
      } else if (data.type === 'RESET') {
        this.reset();
      }
    };
  }

  reset() {
    this.writePos = 0;
    this.readPos = 0;
    this.totalSamplesReceived = 0;
    this.carrierOffset = 0;
    this.pendingMessages.clear();
    this.completedMessages.clear();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const channelData = input[0];
    const numSamples = channelData.length;

    // 1. Push incoming samples to ring buffer
    for (let i = 0; i < numSamples; i++) {
      this.ringBuffer[this.writePos] = channelData[i];
      this.writePos = (this.writePos + 1) % this.ringBufferSize;
    }
    this.totalSamplesReceived += numSamples;

    // 2. Periodic Spectrum Telemetry (~30Hz update rate)
    this.spectrumFrameCounter += numSamples;
    const spectrumInterval = Math.round(this.sampleRate / 30); // ~1600 samples
    if (this.spectrumFrameCounter >= spectrumInterval) {
      this.spectrumFrameCounter = 0;
      this.emitSpectrumTelemetry(channelData);
    }

    // 3. Scan for sync and demodulate packets if sufficient samples accumulated
    this.scanAndDemodulate();

    return true;
  }

  emitSpectrumTelemetry(channelData) {
    const freqs = this.profile.dataFrequencies;
    const powers = new Float32Array(freqs.length);
    let peakP = -1;
    let peakF = freqs[0];

    for (let k = 0; k < freqs.length; k++) {
      const f = freqs[k] + this.carrierOffset;
      const p = this.computeGoertzelPower(f, channelData, 0, channelData.length);
      powers[k] = p;
      if (p > peakP) {
        peakP = p;
        peakF = f;
      }
    }

    this.port.postMessage({
      type: 'SPECTRUM',
      bins: powers,
      peakFreq: peakF,
      sampleRate: this.sampleRate,
    });
  }

  computeGoertzelPower(freq, buffer, offset, length) {
    const N = Math.min(length, buffer.length - offset);
    if (N <= 0) return 0;

    const omega = (2 * Math.PI * freq) / this.sampleRate;
    const coeff = 2 * Math.cos(omega);

    let s0 = 0;
    let s1 = 0;
    let s2 = 0;

    const end = offset + N;
    for (let i = offset; i < end; i++) {
      s0 = buffer[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    return (4 * power) / (N * N);
  }

  scanAndDemodulate() {
    const chipSamples = Math.round((5 / 1000) * this.sampleRate);
    const barkerTotalSamples = chipSamples * BARKER_13_BITS.length;
    const availableSamples = (this.writePos - this.readPos + this.ringBufferSize) % this.ringBufferSize;

    // Require at least barkerTotalSamples + 50ms of data
    const minRequired = barkerTotalSamples + Math.round(0.05 * this.sampleRate);
    if (availableSamples < minRequired) {
      return;
    }

    const f0 = this.profile.pilotFrequencies[0];
    const f1 = this.profile.pilotFrequencies[1] || f0 + 1500;

    // Linear unrolled view for the scan window
    const scanWindowSize = Math.min(availableSamples, 8192);
    const window = new Float32Array(scanWindowSize);
    for (let i = 0; i < scanWindowSize; i++) {
      window[i] = this.ringBuffer[(this.readPos + i) % this.ringBufferSize];
    }

    let scanIdx = 0;
    const maxScan = scanWindowSize - barkerTotalSamples;

    while (scanIdx < maxScan) {
      const p0 = this.computeGoertzelPower(f0, window, scanIdx, chipSamples);
      const p1 = this.computeGoertzelPower(f1, window, scanIdx, chipSamples);

      if (p0 < 1e-6 && p1 < 1e-6) {
        scanIdx += Math.max(1, Math.floor(chipSamples / 2));
        continue;
      }

      let matchScore = 0;
      for (let c = 0; c < BARKER_13_BITS.length; c++) {
        const cOffset = scanIdx + c * chipSamples;
        const cp0 = this.computeGoertzelPower(f0, window, cOffset, chipSamples);
        const cp1 = this.computeGoertzelPower(f1, window, cOffset, chipSamples);
        const expected = BARKER_13_BITS[c];
        if (expected === 1 && cp1 > cp0) matchScore++;
        else if (expected === 0 && cp0 > cp1) matchScore++;
      }

      if (matchScore >= 11) {
        // Refine peak sync position
        const syncEnd = scanIdx + barkerTotalSamples;
        const preDataGuard = Math.round(0.01 * this.sampleRate);
        const dataStart = syncEnd + preDataGuard;

        this.port.postMessage({
          type: 'SYNC_DETECTED',
          confidence: matchScore / 13,
          carrierOffset: this.carrierOffset,
        });

        // Attempt packet demodulation
        const packetResult = this.demodulatePacketFromWindow(window, dataStart);
        if (packetResult) {
          this.port.postMessage({
            type: 'PACKET_DECODED',
            packet: packetResult,
          });

          this.processReassembly(packetResult);

          // Advance read pointer past packet
          const consumed = dataStart + packetResult.samplesConsumed;
          this.readPos = (this.readPos + consumed) % this.ringBufferSize;
          return;
        } else {
          // Advance past sync
          scanIdx = dataStart;
          continue;
        }
      }

      scanIdx += Math.max(1, Math.floor(chipSamples / 3));
    }

    // Advance read pointer safely if no sync found in early part of buffer
    if (scanIdx > 1024) {
      this.readPos = (this.readPos + scanIdx - 512) % this.ringBufferSize;
    }
  }

  demodulatePacketFromWindow(window, dataStartOffset) {
    const activeSamples = Math.round((this.profile.activeDurationMs / 1000) * this.sampleRate);
    const guardSamples = Math.round((this.profile.guardDurationMs / 1000) * this.sampleRate);
    const symTotal = activeSamples + guardSamples;

    const winOffset = Math.round(0.15 * activeSamples);
    const winLen = Math.max(8, Math.round(0.7 * activeSamples));

    // Decode 8-byte header
    const headerSymCount = this.calculateSymbolsForBytes(8);
    const headerSymbols = [];
    let curOffset = dataStartOffset;

    for (let s = 0; s < headerSymCount; s++) {
      if (curOffset + activeSamples > window.length) return null;
      const sym = this.decodeSymbol(window, curOffset + winOffset, winLen);
      headerSymbols.push(sym);
      curOffset += symTotal;
    }

    const headerBytes = this.symbolsToBytes(headerSymbols, 8);
    if (headerBytes[0] !== MAGIC_BYTE) return null;
    if (computeCrc8(headerBytes.subarray(0, 7)) !== headerBytes[7]) {
      this.port.postMessage({
        type: 'CRC_ERROR',
        messageId: (headerBytes[2] << 8) | headerBytes[3],
        expected: headerBytes[7],
        actual: computeCrc8(headerBytes.subarray(0, 7)),
      });
      return null;
    }

    const payloadLen = headerBytes[6];
    if (payloadLen > 64) return null;

    const totalPacketBytes = 8 + payloadLen + 4;
    const totalSymCount = this.calculateSymbolsForBytes(totalPacketBytes);
    const allSymbols = [...headerSymbols];

    for (let s = headerSymCount; s < totalSymCount; s++) {
      if (curOffset + activeSamples > window.length) return null;
      const sym = this.decodeSymbol(window, curOffset + winOffset, winLen);
      allSymbols.push(sym);
      curOffset += symTotal;
    }

    const fullBytes = this.symbolsToBytes(allSymbols, totalPacketBytes);
    const crcOffset = 8 + payloadLen;
    const readCrc =
      ((fullBytes[crcOffset] << 24) |
        (fullBytes[crcOffset + 1] << 16) |
        (fullBytes[crcOffset + 2] << 8) |
        fullBytes[crcOffset + 3]) >>>
      0;

    const calcCrc = computeCrc32(fullBytes.subarray(0, crcOffset));
    if (calcCrc !== readCrc) {
      this.port.postMessage({
        type: 'CRC_ERROR',
        messageId: (headerBytes[2] << 8) | headerBytes[3],
        expected: readCrc,
        actual: calcCrc,
      });
      return null;
    }

    const payload = fullBytes.subarray(8, 8 + payloadLen);
    return {
      header: {
        magic: headerBytes[0],
        profileId: headerBytes[1],
        messageId: (headerBytes[2] << 8) | headerBytes[3],
        totalChunks: headerBytes[4],
        chunkIndex: headerBytes[5],
        payloadLength: payloadLen,
        headerCrc: headerBytes[7],
      },
      payload: Array.from(payload),
      crc32: readCrc,
      samplesConsumed: curOffset - dataStartOffset,
    };
  }

  calculateSymbolsForBytes(numBytes) {
    switch (this.profile.scheme) {
      case '4-fsk':
        return numBytes * 4;
      case '8-fsk':
        return Math.ceil((numBytes * 8) / 3);
      case '16-fsk':
        return numBytes * 2;
      case 'dual-8fsk':
        return Math.ceil((numBytes * 8) / 6);
      default:
        return Math.ceil((numBytes * 8) / 3);
    }
  }

  decodeSymbol(buffer, offset, length) {
    const freqs = this.profile.dataFrequencies;
    let peakP = -1;
    let peakIdx = 0;

    for (let k = 0; k < freqs.length; k++) {
      const f = freqs[k] + this.carrierOffset;
      const p = this.computeGoertzelPower(f, buffer, offset, length);
      if (p > peakP) {
        peakP = p;
        peakIdx = k;
      }
    }

    return peakIdx;
  }

  symbolsToBytes(symbols, expectedLength) {
    const out = new Uint8Array(expectedLength);
    let byteIdx = 0;

    if (this.profile.scheme === '4-fsk') {
      for (let i = 0; i < symbols.length && byteIdx < expectedLength; i += 4) {
        const s0 = symbols[i] || 0;
        const s1 = symbols[i + 1] || 0;
        const s2 = symbols[i + 2] || 0;
        const s3 = symbols[i + 3] || 0;
        out[byteIdx++] = ((s0 & 3) << 6) | ((s1 & 3) << 4) | ((s2 & 3) << 2) | (s3 & 3);
      }
    } else if (this.profile.scheme === '16-fsk') {
      for (let i = 0; i < symbols.length && byteIdx < expectedLength; i += 2) {
        const high = symbols[i] || 0;
        const low = symbols[i + 1] || 0;
        out[byteIdx++] = ((high & 0x0f) << 4) | (low & 0x0f);
      }
    } else {
      // 8-fsk standard
      let bitBuffer = 0;
      let bitCount = 0;
      for (let i = 0; i < symbols.length && byteIdx < expectedLength; i++) {
        bitBuffer = ((bitBuffer << 3) | (symbols[i] & 0x07)) >>> 0;
        bitCount += 3;
        while (bitCount >= 8 && byteIdx < expectedLength) {
          bitCount -= 8;
          out[byteIdx++] = (bitBuffer >> bitCount) & 0xff;
          bitBuffer = bitBuffer & ((1 << bitCount) - 1);
        }
      }
    }

    return out;
  }

  processReassembly(packet) {
    const { messageId, totalChunks, chunkIndex } = packet.header;
    const now = Date.now();

    if (this.completedMessages.has(messageId)) return;

    let pending = this.pendingMessages.get(messageId);
    if (!pending) {
      pending = {
        totalChunks,
        chunks: new Array(totalChunks).fill(null),
        received: 0,
      };
      this.pendingMessages.set(messageId, pending);
    }

    if (pending.chunks[chunkIndex] === null) {
      pending.chunks[chunkIndex] = new Uint8Array(packet.payload);
      pending.received++;

      if (pending.received === pending.totalChunks) {
        let totalLen = 0;
        for (const c of pending.chunks) {
          if (c) totalLen += c.length;
        }

        const fullBytes = new Uint8Array(totalLen);
        let off = 0;
        for (const c of pending.chunks) {
          if (c) {
            fullBytes.set(c, off);
            off += c.length;
          }
        }

        // Decode UTF-8 string
        let text = '';
        try {
          // Worklet environments support TextDecoder in modern browsers
          if (typeof TextDecoder !== 'undefined') {
            text = new TextDecoder('utf-8').decode(fullBytes);
          } else {
            text = String.fromCharCode(...fullBytes);
          }
        } catch (e) {
          text = String.fromCharCode(...fullBytes);
        }

        this.completedMessages.set(messageId, now);
        this.pendingMessages.delete(messageId);

        this.port.postMessage({
          type: 'MESSAGE_COMPLETED',
          message: {
            messageId,
            text,
            chunkCount: totalChunks,
            timestamp: now,
            profileId: this.profile.id,
          },
        });
      }
    }
  }
}

registerProcessor('ultralink-decoder-processor', UltralinkDecoderProcessor);
