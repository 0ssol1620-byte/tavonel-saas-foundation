/*
  A PostgreSQL timestamptz as PostgREST serializes it, at full microsecond precision.

  `Date.parse` keeps milliseconds only, so two observation instants 0.4 ms apart compare equal and
  a unique latest binding would be refused as ambiguous. This keeps all six fraction digits and the
  offset, and returns null for anything else rather than guessing.
*/
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

export function databaseInstantMicros(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const match = INSTANT.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = "", zone] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const millis = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  const check = new Date(millis);
  // Reject calendar overflow (2026-02-30 would silently become March).
  if (!Number.isFinite(millis) || check.getUTCFullYear() !== parts[0] || check.getUTCMonth() !== parts[1] - 1 ||
      check.getUTCDate() !== parts[2] || check.getUTCHours() !== parts[3] || check.getUTCMinutes() !== parts[4] ||
      check.getUTCSeconds() !== parts[5]) return null;
  let offsetSeconds = 0;
  if (zone !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    const hours = Number(digits.slice(0, 2)), minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    if (digits.length !== 2 && digits.length !== 4) return null;
    if (hours > 15 || minutes > 59) return null;
    offsetSeconds = (zone[0] === "-" ? -1 : 1) * (hours * 3600 + minutes * 60);
  }
  return BigInt(millis / 1000 - offsetSeconds) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
