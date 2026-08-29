import { createHmac, timingSafeEqual } from "node:crypto";

type Signature = { timestamp: number; hashes: string[] };
export function parsePaddleSignature(header: string): Signature | null {
  const fields = header.split(";").map(value => value.trim());
  const timestampValue = fields.find(value => value.startsWith("ts="))?.slice(3);
  const hashes = fields.filter(value => value.startsWith("h1=")).map(value => value.slice(3));
  if (!timestampValue || !/^\d+$/.test(timestampValue) || hashes.length === 0 || hashes.some(hash => !/^[a-f0-9]{64}$/i.test(hash))) return null;
  return { timestamp: Number(timestampValue), hashes };
}
export function verifyPaddleSignature(rawBody: string, signatureHeader: string | null, secret: string | undefined, now = Date.now()) {
  if (!signatureHeader || !secret || secret.length < 32) return false;
  const signature = parsePaddleSignature(signatureHeader);
  if (!signature || Math.abs(now - signature.timestamp * 1000) > 300_000) return false;
  const expected = createHmac("sha256", secret).update(`${signature.timestamp}:${rawBody}`, "utf8").digest();
  return signature.hashes.some(hash => { const received = Buffer.from(hash, "hex"); return received.length === expected.length && timingSafeEqual(received, expected); });
}
