/**
 * UltraLink Packet Protocol & Binary Framing
 * Linear chirp preamble, Barker-13 sync, 8-byte CRC8 header,
 * UTF-8 payload chunking (Unicode, emoji), CRC32 trailer,
 * duplicate detection cache, and out-of-order reassembly.
 */

import { computeCrc8, computeCrc32, verifyCrc8, verifyCrc32 } from './crc';
import { ModulationProfile, ProfileId, getProfile, getProfileByNumericId } from './profiles';

export const MAGIC_BYTE = 0xd5; // UltraLink protocol magic identifier

/** Barker-13 bipolar sequence (+1 and -1) for optimum aperiodic autocorrelation */
export const BARKER_13: readonly number[] = [1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1];
export const BARKER_13_BITS: readonly number[] = [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1];

export interface PacketHeader {
  magic: number;          // 0xD5 (1 byte)
  version?: number;       // Protocol version (1)
  profileId: number;      // 0..3 (1 byte)
  messageId: number;      // 0..65535 (2 bytes, Big-Endian)
  totalChunks: number;    // 1..255 (1 byte)
  chunkIndex: number;     // 0..254 (1 byte)
  payloadLength: number;  // 0..64 (1 byte)
  headerCrc: number;      // CRC8 of bytes 0..6 (1 byte)
}

export interface Packet {
  header: PacketHeader;
  payload: Uint8Array;
  crc32: number;
}

export interface DecodedMessage {
  messageId: number;
  text: string;
  rawBytes: Uint8Array;
  profileId: ProfileId;
  chunkCount: number;
  timestamp: number;
  crcPassed: boolean;
  snrAverage: number;
  snrDb?: number;
  sampleRate?: number;
  durationMs?: number;
}

/**
 * Serialize PacketHeader into 8-byte Uint8Array
 */
export function serializeHeader(header: PacketHeader): Uint8Array {
  const buf = new Uint8Array(8);
  buf[0] = header.magic & 0xff;
  buf[1] = header.profileId & 0xff;
  buf[2] = (header.messageId >> 8) & 0xff;
  buf[3] = header.messageId & 0xff;
  buf[4] = header.totalChunks & 0xff;
  buf[5] = header.chunkIndex & 0xff;
  buf[6] = header.payloadLength & 0xff;
  buf[7] = computeCrc8(buf.subarray(0, 7));
  return buf;
}

/**
 * Deserialize 8-byte Uint8Array into PacketHeader, verifying CRC8
 */
export function deserializeHeader(buf: Uint8Array): PacketHeader | null {
  if (buf.length < 8) return null;
  if (buf[0] !== MAGIC_BYTE) return null;

  const expectedCrc = buf[7];
  if (!verifyCrc8(buf.subarray(0, 7), expectedCrc)) {
    return null; // Header CRC8 mismatch
  }

  const profileId = buf[1];
  const messageId = ((buf[2] << 8) | buf[3]) >>> 0;
  const totalChunks = buf[4];
  const chunkIndex = buf[5];
  const payloadLength = buf[6];

  if (totalChunks === 0 || chunkIndex >= totalChunks || payloadLength > 64) {
    return null;
  }

  return {
    magic: buf[0],
    profileId,
    messageId,
    totalChunks,
    chunkIndex,
    payloadLength,
    headerCrc: expectedCrc,
  };
}

/**
 * Serialize entire Packet: [Header (8B) | Payload (LB) | CRC32 (4B)]
 */
export function serializePacket(packet: Packet): Uint8Array {
  const headerBytes = serializeHeader(packet.header);
  const totalLength = 8 + packet.payload.length + 4;
  const out = new Uint8Array(totalLength);

  out.set(headerBytes, 0);
  out.set(packet.payload, 8);

  const crc32Val = computeCrc32(out.subarray(0, 8 + packet.payload.length));
  const crcOffset = 8 + packet.payload.length;
  out[crcOffset] = (crc32Val >>> 24) & 0xff;
  out[crcOffset + 1] = (crc32Val >>> 16) & 0xff;
  out[crcOffset + 2] = (crc32Val >>> 8) & 0xff;
  out[crcOffset + 3] = crc32Val & 0xff;

  return out;
}

/**
 * Deserialize entire Packet from bytes and verify CRC8 and CRC32
 */
export function deserializePacket(bytes: Uint8Array): Packet | null {
  if (bytes.length < 12) return null; // 8 bytes header + 0 bytes payload + 4 bytes CRC32

  const header = deserializeHeader(bytes.subarray(0, 8));
  if (!header) return null;

  const expectedTotalLen = 8 + header.payloadLength + 4;
  if (bytes.length < expectedTotalLen) return null;

  const packetBytes = bytes.subarray(0, expectedTotalLen);
  const payload = packetBytes.subarray(8, 8 + header.payloadLength);

  const crcOffset = 8 + header.payloadLength;
  const readCrc32 =
    ((packetBytes[crcOffset] << 24) |
      (packetBytes[crcOffset + 1] << 16) |
      (packetBytes[crcOffset + 2] << 8) |
      packetBytes[crcOffset + 3]) >>>
    0;

  const computedCrc32 = computeCrc32(packetBytes.subarray(0, crcOffset));
  if (computedCrc32 !== readCrc32) {
    return null; // CRC32 verification failed
  }

  return {
    header,
    payload: new Uint8Array(payload),
    crc32: readCrc32,
  };
}

/**
 * Split text into framed packets according to profile chunk limits
 */
export function chunkText(
  text: string,
  profile: ModulationProfile,
  customMessageId?: number
): Packet[] {
  const utf8Bytes = new TextEncoder().encode(text);
  const maxPayload = profile.maxPayloadBytes;
  const messageId =
    customMessageId !== undefined
      ? customMessageId & 0xffff
      : Math.floor(Math.random() * 65535) + 1;

  if (utf8Bytes.length === 0) {
    const header: PacketHeader = {
      magic: MAGIC_BYTE,
      profileId: profile.numericId,
      messageId,
      totalChunks: 1,
      chunkIndex: 0,
      payloadLength: 0,
      headerCrc: 0,
    };
    header.headerCrc = computeCrc8(serializeHeader(header).subarray(0, 7));
    const payload = new Uint8Array(0);
    const crc32Val = computeCrc32(serializeHeader(header));
    return [{ header, payload, crc32: crc32Val }];
  }

  const totalChunks = Math.ceil(utf8Bytes.length / maxPayload);
  const packets: Packet[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * maxPayload;
    const end = Math.min(start + maxPayload, utf8Bytes.length);
    const chunkPayload = utf8Bytes.subarray(start, end);

    const header: PacketHeader = {
      magic: MAGIC_BYTE,
      profileId: profile.numericId,
      messageId,
      totalChunks,
      chunkIndex: i,
      payloadLength: chunkPayload.length,
      headerCrc: 0,
    };
    const headerBytes = serializeHeader(header);
    header.headerCrc = headerBytes[7];

    const dataForCrc = new Uint8Array(8 + chunkPayload.length);
    dataForCrc.set(headerBytes, 0);
    dataForCrc.set(chunkPayload, 8);
    const crc32 = computeCrc32(dataForCrc);

    packets.push({
      header,
      payload: new Uint8Array(chunkPayload),
      crc32,
    });
  }

  return packets;
}

interface PendingMessage {
  messageId: number;
  profileId: number;
  totalChunks: number;
  receivedChunks: (Uint8Array | null)[];
  receivedCount: number;
  firstSeen: number;
  lastSeen: number;
  snrSum: number;
}

/**
 * Out-of-Order Packet Reassembler & Deduplication Engine
 */
export class PacketReassembler {
  private pending = new Map<number, PendingMessage>();
  private completedCache = new Map<number, number>(); // messageId -> timestamp
  private duplicateDropCount = 0;
  private readonly ttlMs: number;
  private readonly completedCacheTtlMs: number;

  constructor(ttlMs = 30000, completedCacheTtlMs = 60000) {
    this.ttlMs = ttlMs;
    this.completedCacheTtlMs = completedCacheTtlMs;
  }

  /**
   * Feed a decoded packet into the reassembler
   * Returns DecodedMessage if the message is fully completed, null otherwise.
   */
  public addPacket(packet: Packet, snrDb = 10.0): DecodedMessage | null {
    const { messageId, totalChunks, chunkIndex, profileId } = packet.header;
    const now = Date.now();

    // Clean expired entries
    this.cleanup(now);

    // 1. Deduplication check: Has this message already been completed?
    if (this.completedCache.has(messageId)) {
      this.duplicateDropCount++;
      return null;
    }

    // 2. Fetch or create pending message state
    let pending = this.pending.get(messageId);
    if (!pending) {
      pending = {
        messageId,
        profileId,
        totalChunks,
        receivedChunks: new Array(totalChunks).fill(null),
        receivedCount: 0,
        firstSeen: now,
        lastSeen: now,
        snrSum: 0,
      };
      this.pending.set(messageId, pending);
    }

    // Guard against mismatch in totalChunks across same messageId
    if (pending.totalChunks !== totalChunks || chunkIndex >= totalChunks) {
      return null;
    }

    // 3. Duplicate chunk check: has this chunk already arrived?
    if (pending.receivedChunks[chunkIndex] !== null) {
      this.duplicateDropCount++;
      return null;
    }

    // Store chunk
    pending.receivedChunks[chunkIndex] = packet.payload;
    pending.receivedCount++;
    pending.lastSeen = now;
    pending.snrSum += snrDb;

    // 4. Check if all chunks have been received
    if (pending.receivedCount === pending.totalChunks) {
      // Calculate total payload length
      let totalLength = 0;
      for (const chunk of pending.receivedChunks) {
        if (chunk) totalLength += chunk.length;
      }

      // Concatenate all chunks in index order
      const fullBytes = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of pending.receivedChunks) {
        if (chunk) {
          fullBytes.set(chunk, offset);
          offset += chunk.length;
        }
      }

      const decodedText = new TextDecoder('utf-8', { fatal: false }).decode(fullBytes);
      const profile = getProfileByNumericId(pending.profileId);
      const avgSnr = pending.receivedCount > 0 ? pending.snrSum / pending.receivedCount : snrDb;

      // Mark completed in deduplication cache
      this.completedCache.set(messageId, now);
      this.pending.delete(messageId);

      return {
        messageId,
        text: decodedText,
        rawBytes: fullBytes,
        profileId: profile.id,
        chunkCount: totalChunks,
        timestamp: now,
        crcPassed: true,
        snrAverage: avgSnr,
        snrDb: avgSnr,
      };
    }

    return null;
  }

  public getDuplicateDropCount(): number {
    return this.duplicateDropCount;
  }

  public isMessageCompleted(messageId: number): boolean {
    return this.completedCache.has(messageId);
  }

  public reset(): void {
    this.pending.clear();
    this.completedCache.clear();
    this.duplicateDropCount = 0;
  }

  private cleanup(now: number): void {
    // Clean pending
    for (const [id, msg] of this.pending.entries()) {
      if (now - msg.lastSeen > this.ttlMs) {
        this.pending.delete(id);
      }
    }
    // Clean completed cache
    for (const [id, ts] of this.completedCache.entries()) {
      if (now - ts > this.completedCacheTtlMs) {
        this.completedCache.delete(id);
      }
    }
  }
}
