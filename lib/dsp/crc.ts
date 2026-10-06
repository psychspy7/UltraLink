/**
 * UltraLink CRC Implementation
 * - CRC8: Header verification with polynomial x^8 + x^2 + x + 1 (0x07)
 * - CRC32: Standard IEEE 802.3 payload verification (0xEDB88320)
 */

// Precompute CRC-8 lookup table (polynomial 0x07)
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

// Precompute CRC-32 IEEE 802.3 lookup table (polynomial 0xEDB88320)
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

/**
 * Compute 8-bit CRC over byte sequence
 */
export function computeCrc8(data: Uint8Array | number[]): number {
  let crc = 0x00;
  for (let i = 0; i < data.length; i++) {
    crc = CRC8_TABLE[crc ^ data[i]];
  }
  return crc;
}

/**
 * Verify 8-bit CRC
 */
export function verifyCrc8(data: Uint8Array | number[], expectedCrc: number): boolean {
  return computeCrc8(data) === (expectedCrc & 0xff);
}

/**
 * Compute standard IEEE 802.3 32-bit CRC (matches gzip, PNG, Ethernet)
 * Test vector: ASCII "123456789" -> 0xCBF43926 (3422760278)
 */
export function computeCrc32(data: Uint8Array | number[]): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Verify 32-bit CRC
 */
export function verifyCrc32(data: Uint8Array | number[], expectedCrc: number): boolean {
  return (computeCrc32(data) >>> 0) === (expectedCrc >>> 0);
}
