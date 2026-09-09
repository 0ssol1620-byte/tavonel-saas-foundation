/** Microsoft QuickXorHash content comparison; not a cryptographic security primitive. */
export function quickXorHash(bytes: Uint8Array): string {
  const folded = new Uint8Array(160);
  for (let i = 0; i < bytes.length; i += 1) folded[i % 160] ^= bytes[i];
  const result = Buffer.alloc(20);
  for (let i = 0; i < folded.length; i += 1) {
    const bit = (i * 11) % 160, index = Math.floor(bit / 8), shift = bit % 8;
    result[index] ^= (folded[i] << shift) & 255;
    result[(index + 1) % 20] ^= folded[i] >>> (8 - shift);
  }
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(bytes.length));
  for (let i = 0; i < 8; i += 1) result[12 + i] ^= length[i];
  return result.toString("base64");
}
