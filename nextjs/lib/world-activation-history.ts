import { COLLECTION_ID_PATTERN, WORKSPACE_ID_PATTERN } from "./immutable-keys";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  Typed time on World reads (WO-D18-2, DN-6).

  Two clocks, and only one of them exists at the Product layer.

  `known_at` is "the World this workspace had activated at T": the latest promote or rollback in
  the append-only `foundation_world_events` log whose `created_at` is not after T. It is a fact
  about this product's own history, and it is answered from that log or not at all.

  `valid_at` is "what was true in the world at T". A Foundation World carries no per-fact valid
  time, so the honest answer is an abstention (422), never a synthetic history built from
  activation dates. `as_of` is refused: aliasing it to either clock would guess which one the
  caller meant.
*/

export type TemporalRefusal = { ok: false; code: string; status: number };

// RFC 3339 date-time, offset required. A date alone, or a time with no offset, names no instant.
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([Zz]|[+-]\d{2}:\d{2})$/;

/** Epoch milliseconds of an RFC 3339 date-time with an explicit offset, or null if it is not one. */
function rfc3339Ms(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = RFC3339.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const zone = m[8]!;
  const offsetHours = zone.length === 6 ? Number(zone.slice(1, 3)) : 0;
  const offsetMinutes = zone.length === 6 ? Number(zone.slice(4, 6)) : 0;
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59) return null;
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  // ponytail: sub-millisecond digits are dropped; that only moves T earlier, so it can never serve a later World.
  const ms = Number((m[7] ?? "").padEnd(3, "0").slice(0, 3));
  const sign = zone.startsWith("-") ? -1 : 1;
  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - sign * (offsetHours * 60 + offsetMinutes) * 60_000;
}

/**
 * Validates the three typed time fields of one request. Absent (undefined or null) means not
 * sent; anything else that is not a single RFC 3339 string is refused, so a repeated query
 * parameter or a JSON number cannot slip past as "no time".
 */
export function parseTemporal(
  raw: { known_at?: unknown; valid_at?: unknown; as_of?: unknown },
  now = Date.now(),
): { ok: true; knownAt: string | null } | TemporalRefusal {
  const sent = (value: unknown) => value !== undefined && value !== null;
  if (sent(raw.as_of)) return { ok: false, code: "AS_OF_AMBIGUOUS", status: 400 };
  let knownAt: string | null = null;
  if (sent(raw.known_at)) {
    const ms = rfc3339Ms(raw.known_at);
    if (ms === null) return { ok: false, code: "KNOWN_AT_INVALID", status: 400 };
    if (ms > now) return { ok: false, code: "KNOWN_AT_IN_FUTURE", status: 400 };
    knownAt = new Date(ms).toISOString();
  }
  if (sent(raw.valid_at)) {
    if (rfc3339Ms(raw.valid_at) === null) return { ok: false, code: "VALID_AT_INVALID", status: 400 };
    return { ok: false, code: "VALID_TIME_NOT_RECORDED", status: 422 };
  }
  return { ok: true, knownAt };
}

const SHA256 = /^sha256:[a-f0-9]{64}$/;

/**
 * The World this collection had activated at `knownAtIso` (an ISO instant from `parseTemporal`).
 *
 * Both keys come from the authorized principal and the path and are validated before a request
 * is built; the request always carries both exact filters and reads one row, so it can neither
 * widen into another tenant's history nor into a scan. A store that cannot be read is a 503 --
 * it is never reported as "no history".
 */
export async function resolveWorldAtKnownAt(workspaceKey: string, collectionId: string, knownAtIso: string) {
  if (
    typeof workspaceKey !== "string" || !WORKSPACE_ID_PATTERN.test(workspaceKey) ||
    typeof collectionId !== "string" || !COLLECTION_ID_PATTERN.test(collectionId)
  ) {
    return { ok: false as const, code: "WORLD_ID_INVALID", status: 400 };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "WORLD_STORE_NOT_CONFIGURED", status: 503 };
  const query = new URLSearchParams({
    select: "to_manifest_digest,created_at,action",
    workspace_key: `eq.${workspaceKey}`,
    collection_id: `eq.${collectionId}`,
    created_at: `lte.${knownAtIso}`,
    order: "created_at.desc,event_id.desc",
    limit: "1",
  });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_world_events?${query}`);
    if (!response.ok) return { ok: false as const, code: "WORLD_STORE_READ_FAILED", status: 503 };
    const rows: unknown = await response.json();
    // A 200 that is not a list is a store that did not answer, never "no history".
    if (!Array.isArray(rows)) return { ok: false as const, code: "WORLD_STORE_READ_FAILED", status: 503 };
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return { ok: false as const, code: "KNOWN_AT_BEFORE_FIRST_ACTIVATION", status: 404 };
    const manifestDigest = String(row.to_manifest_digest ?? "");
    const activatedMs = Date.parse(String(row.created_at ?? ""));
    if (!SHA256.test(manifestDigest) || !Number.isFinite(activatedMs)) {
      return { ok: false as const, code: "WORLD_STORE_READ_FAILED", status: 503 };
    }
    return { ok: true as const, manifestDigest, activatedAt: new Date(activatedMs).toISOString() };
  } catch {
    return { ok: false as const, code: "WORLD_STORE_READ_FAILED", status: 503 };
  }
}

/** The `temporal` block a known_at read carries, so the caller sees which World answered and why. */
export function temporalBlock(knownAt: string, resolved: { manifestDigest: string; activatedAt: string }, current: boolean) {
  return {
    knownAt,
    resolution: "world_activation_log" as const,
    manifestDigest: resolved.manifestDigest,
    activatedAt: resolved.activatedAt,
    current,
  };
}
