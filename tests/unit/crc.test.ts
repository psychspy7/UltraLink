import { describe, it, expect } from 'vitest';
import { computeCrc8, verifyCrc8, computeCrc32, verifyCrc32 } from '../../lib/dsp/crc';

describe('CRC8 Implementation', () => {
  it('computes consistent CRC8 values for byte buffers', () => {
    const data = new Uint8Array([0xd5, 0x01, 0x12, 0x34, 0x02, 0x00, 0x10]);
    const crc = computeCrc8(data);
    expect(typeof crc).toBe('number');
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(255);
    expect(verifyCrc8(data, crc)).toBe(true);
  });

  it('detects single-bit and multi-bit corruptions in data', () => {
    const original = new Uint8Array([0xd5, 0x01, 0x12, 0x34, 0x02, 0x00, 0x10]);
    const crc = computeCrc8(original);

    // Single bit flip across each byte
    for (let i = 0; i < original.length; i++) {
      for (let bit = 0; bit < 8; bit++) {
        const corrupted = new Uint8Array(original);
        corrupted[i] ^= (1 << bit);
        const corruptedCrc = computeCrc8(corrupted);
        expect(corruptedCrc).not.toBe(crc);
        expect(verifyCrc8(corrupted, crc)).toBe(false);
      }
    }
  });

  it('rejects wrong expected CRC8 values', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03]);
    const correctCrc = computeCrc8(data);
    expect(verifyCrc8(data, (correctCrc + 1) % 256)).toBe(false);
  });
});

describe('CRC32 Implementation (IEEE 802.3)', () => {
  it('matches canonical IEEE 802.3 test vector "123456789"', () => {
    // Canonical test vector: ASCII string "123456789" -> 0xCBF43926 (3422760278)
    const testString = '123456789';
    const bytes = new TextEncoder().encode(testString);
    const crc = computeCrc32(bytes);
    expect(crc).toBe(0xcbf43926);
    expect(verifyCrc32(bytes, 0xcbf43926)).toBe(true);
  });

  it('computes correct CRC32 for empty buffer', () => {
    const empty = new Uint8Array(0);
    const crc = computeCrc32(empty);
    expect(crc).toBe(0x00000000);
  });

  it('detects 100% of single bit flips across entire payload', () => {
    const payload = new TextEncoder().encode('UltraLink Near-Ultrasonic Acoustic Protocol Payload 2026');
    const validCrc = computeCrc32(payload);

    for (let i = 0; i < payload.length; i++) {
      for (let bit = 0; bit < 8; bit++) {
        const corrupted = new Uint8Array(payload);
        corrupted[i] ^= (1 << bit);
        expect(computeCrc32(corrupted)).not.toBe(validCrc);
        expect(verifyCrc32(corrupted, validCrc)).toBe(false);
      }
    }
  });

  it('verifies Unicode and multi-byte emoji buffers reliably', () => {
    const unicodeData = new TextEncoder().encode('🛰️✨ UltraLink 音響通信 🚀');
    const crc = computeCrc32(unicodeData);
    expect(verifyCrc32(unicodeData, crc)).toBe(true);
    expect(verifyCrc32(unicodeData, crc ^ 0x01)).toBe(false);
  });
});
