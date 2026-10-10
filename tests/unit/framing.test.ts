import { describe, it, expect } from 'vitest';
import {
  MAGIC_BYTE,
  PacketHeader,
  serializeHeader,
  deserializeHeader,
  serializePacket,
  deserializePacket,
  chunkText,
  PacketReassembler,
} from '../../lib/dsp/framing';
import { PROFILES } from '../../lib/dsp/profiles';

describe('Packet Framing & Header Serialization', () => {
  it('serializes and deserializes valid 8-byte headers with CRC8 verification', () => {
    const originalHeader: PacketHeader = {
      magic: MAGIC_BYTE,
      profileId: 1, // Balanced
      messageId: 42100,
      totalChunks: 5,
      chunkIndex: 2,
      payloadLength: 28,
      headerCrc: 0,
    };

    const bytes = serializeHeader(originalHeader);
    expect(bytes.length).toBe(8);
    expect(bytes[0]).toBe(MAGIC_BYTE);
    expect(bytes[1]).toBe(1);

    const deserialized = deserializeHeader(bytes);
    expect(deserialized).not.toBeNull();
    expect(deserialized?.magic).toBe(MAGIC_BYTE);
    expect(deserialized?.profileId).toBe(1);
    expect(deserialized?.messageId).toBe(42100);
    expect(deserialized?.totalChunks).toBe(5);
    expect(deserialized?.chunkIndex).toBe(2);
    expect(deserialized?.payloadLength).toBe(28);
    expect(deserialized?.headerCrc).toBe(bytes[7]);
  });

  it('rejects corrupted headers with invalid CRC8 or wrong magic byte', () => {
    const validHeader: PacketHeader = {
      magic: MAGIC_BYTE,
      profileId: 0,
      messageId: 100,
      totalChunks: 1,
      chunkIndex: 0,
      payloadLength: 10,
      headerCrc: 0,
    };

    const bytes = serializeHeader(validHeader);

    // Corrupt one byte
    const corrupted = new Uint8Array(bytes);
    corrupted[3] ^= 0xff;
    expect(deserializeHeader(corrupted)).toBeNull();

    // Wrong magic byte
    const wrongMagic = new Uint8Array(bytes);
    wrongMagic[0] = 0xaa;
    expect(deserializeHeader(wrongMagic)).toBeNull();

    // Truncated buffer
    expect(deserializeHeader(bytes.subarray(0, 7))).toBeNull();
  });
});

describe('Full Packet Serialization & Deserialization', () => {
  it('serializes and deserializes full packets with CRC32 verification', () => {
    const payload = new TextEncoder().encode('Hello UltraLink 17kHz!');
    const header: PacketHeader = {
      magic: MAGIC_BYTE,
      profileId: 1,
      messageId: 1234,
      totalChunks: 1,
      chunkIndex: 0,
      payloadLength: payload.length,
      headerCrc: 0,
    };
    header.headerCrc = serializeHeader(header)[7];

    const packet = { header, payload, crc32: 0 };
    const serialized = serializePacket(packet);

    expect(serialized.length).toBe(8 + payload.length + 4);

    const deserialized = deserializePacket(serialized);
    expect(deserialized).not.toBeNull();
    expect(deserialized?.header.messageId).toBe(1234);
    expect(new TextDecoder().decode(deserialized?.payload)).toBe('Hello UltraLink 17kHz!');
  });

  it('rejects packets with corrupted payload or CRC32 mismatch', () => {
    const payload = new TextEncoder().encode('Sensitive Acoustic Data');
    const header: PacketHeader = {
      magic: MAGIC_BYTE,
      profileId: 1,
      messageId: 555,
      totalChunks: 1,
      chunkIndex: 0,
      payloadLength: payload.length,
      headerCrc: 0,
    };

    const packet = { header, payload, crc32: 0 };
    const serialized = serializePacket(packet);

    // Corrupt one payload byte
    const corrupted = new Uint8Array(serialized);
    corrupted[10] ^= 0x01;
    expect(deserializePacket(corrupted)).toBeNull();

    // Corrupt CRC32 trailer
    const corruptedCrc = new Uint8Array(serialized);
    corruptedCrc[corruptedCrc.length - 1] ^= 0x01;
    expect(deserializePacket(corruptedCrc)).toBeNull();
  });
});

describe('Text Chunking & UTF-8 / Emoji Support', () => {
  it('correctly chunks large ASCII text respecting profile max payload size', () => {
    const text = 'UltraLink is an acoustic data-over-sound transmission system operating offline in web browsers.';
    const profile = PROFILES.reliable; // max 16 bytes per chunk
    const packets = chunkText(text, profile, 999);

    const expectedChunks = Math.ceil(new TextEncoder().encode(text).length / 16);
    expect(packets.length).toBe(expectedChunks);

    for (let i = 0; i < packets.length; i++) {
      expect(packets[i].header.messageId).toBe(999);
      expect(packets[i].header.totalChunks).toBe(expectedChunks);
      expect(packets[i].header.chunkIndex).toBe(i);
      expect(packets[i].payload.length).toBeLessThanOrEqual(16);
    }
  });

  it('preserves multi-byte Unicode and 4-byte Emojis across chunk boundaries', () => {
    const text = '🛰️ Satellite Link 🚀 Telemetry ✨ 日本語テスト 📡 100% Offline!';
    const profile = PROFILES.balanced; // max 32 bytes per chunk
    const packets = chunkText(text, profile, 777);

    // Reconstruct without reassembler directly
    let totalLen = 0;
    for (const p of packets) totalLen += p.payload.length;
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of packets) {
      combined.set(p.payload, offset);
      offset += p.payload.length;
    }

    const reconstructed = new TextDecoder().decode(combined);
    expect(reconstructed).toBe(text);
  });
});

describe('Out-of-Order Reassembly & Duplicate Detection', () => {
  it('reassembles chunks arriving out of order (e.g. 2, 0, 1)', () => {
    const text = 'Three chunk test message for reassembly engine!';
    const profile = PROFILES.reliable; // 16 bytes per chunk
    const packets = chunkText(text, profile, 4321);

    expect(packets.length).toBeGreaterThanOrEqual(3);

    const reassembler = new PacketReassembler();

    // Feed chunk 2 first
    const r2 = reassembler.addPacket(packets[2]);
    expect(r2).toBeNull();

    // Feed chunk 0
    const r0 = reassembler.addPacket(packets[0]);
    expect(r0).toBeNull();

    // Feed remaining chunks
    let finalMsg = null;
    for (let i = 1; i < packets.length; i++) {
      if (i === 2) continue; // Already added
      finalMsg = reassembler.addPacket(packets[i]);
    }

    expect(finalMsg).not.toBeNull();
    expect(finalMsg?.text).toBe(text);
    expect(finalMsg?.messageId).toBe(4321);
    expect(finalMsg?.crcPassed).toBe(true);
  });

  it('rejects duplicate chunks and duplicate completed messages', () => {
    const text = 'Duplicate test message spanning multiple payload chunks';
    const profile = PROFILES.balanced;
    const packets = chunkText(text, profile, 8888);

    const reassembler = new PacketReassembler();

    // Send chunk 0 twice
    expect(reassembler.addPacket(packets[0])).toBeNull();
    expect(reassembler.addPacket(packets[0])).toBeNull(); // Duplicate chunk dropped
    expect(reassembler.getDuplicateDropCount()).toBe(1);

    // Finish message
    for (let i = 1; i < packets.length; i++) {
      reassembler.addPacket(packets[i]);
    }
    expect(reassembler.isMessageCompleted(8888)).toBe(true);

    // Sending a packet for already completed message should be dropped
    expect(reassembler.addPacket(packets[0])).toBeNull();
    expect(reassembler.getDuplicateDropCount()).toBe(2);
  });
});
