import { loadActiveWorldSourceIds } from "./active-world-source-access";
import { checkConnectorSourceAccess } from "./connector-source-access";
import { admitsDerivedCustomerData, DERIVED_DATA_REFUSED } from "./derived-data-admission";
import { revalidateFoundationAuthorization, type FoundationPrincipal } from "./developer-auth";
import type { DeveloperScope } from "./developer-contracts";
import { getFoundationActiveWorld, getFoundationWorldVersion, type ActiveWorld } from "./world-store";
import {
  CONSUMER_CONTEXT_ENFORCEMENT,
  CONTEXT_HEADERS,
  CONTEXT_REQUIRED_MARKER,
  ConsumerContextError,
  contextFromHeaders,
  contextIdentity,
} from "../public/developer/consumer-context.mjs";

/*
  The server half of the consumer-context protocol, for an API route that already holds a
  verified FoundationPrincipal (lib/developer-auth.ts).

  Wired into the World reads (GET /v1/world/{id}, /v1/world/{id}/{lens},
  /v1/world/{id}/manifest-status), discovery (GET /v1/collections) and the two question routes
  (POST /collections/{id}/search and /ask, which the /v1 paths delegate to). That wiring is
  exercised by lib/consumer-context/consumer-context-parity.test.ts against the actual exported
  handlers, with auth and the World store replaced by owned synthetic fixtures -- local evidence,
  not a deployed API. CONSUMER_CONTEXT_ENFORCEMENT, re-exported unchanged from the client module,
  still says productionApiSupport: false, because nothing here has been deployed or exercised
  against real auth and storage.

  The order every wired route follows:
    1. authorize exactly as today, which yields the principal;
    2. bindConsumerContext -- legacy, a bound context, or a refusal with a stable code. Legacy
       goes on exactly as before and nothing below runs for it;
    3. resolveBoundSnapshot against the collection's active World, before any cache is consulted;
    4. build the payload from the resolved World;
    5. releaseConsumerContext with the snapshot the payload was actually built from: authorization
       and source admission are revalidated, the active World is read once more, and only then is
       the acknowledgement returned, to be sent beside Cache-Control: no-store.

  The first half of this file is pure and reads nothing. The two async functions at the end read
  through the existing store, source-access and authorization helpers only. Nothing a request says
  about itself is taken as an answer: the claimed identity is only compared with one the server
  recomputes, and a pinned snapshot header is a demand to check, never what an acknowledgement
  reports.
*/
export { CONSUMER_CONTEXT_ENFORCEMENT };

/**
 * Every refusal this module returns, with its HTTP status. Codes and statuses are API contract;
 * where the synthetic boundary in consumer-context-parity.test.ts refuses the same fault, it uses
 * the same code and status.
 */
export const CONSUMER_CONTEXT_REFUSALS = Object.freeze({
  CONSUMER_CONTEXT_REQUIRED: 400,
  CONSUMER_CONTEXT_INVALID: 400,
  CONSUMER_CONTEXT_SCHEMA_UNSUPPORTED: 400,
  CONSUMER_CONTEXT_IDENTITY_MISMATCH: 400,
  CONSUMER_CONTEXT_STALE: 401,
  CONSUMER_CONTEXT_TENANT_MISMATCH: 403,
  CONSUMER_CONTEXT_PRINCIPAL_MISMATCH: 403,
  CONSUMER_CONTEXT_SCOPE_DENIED: 403,
  CONSUMER_CONTEXT_SCOPE_NOT_GRANTED: 403,
  CONSUMER_CONTEXT_COLLECTION_MISMATCH: 403,
  CONSUMER_CONTEXT_SNAPSHOT_UNKNOWN: 404,
  CONSUMER_CONTEXT_SNAPSHOT_MISMATCH: 409,
  CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED: 409,
  CONSUMER_CONTEXT_SNAPSHOT_UNRESOLVED: 500,
} as const);

export type ConsumerContextRefusalCode = keyof typeof CONSUMER_CONTEXT_REFUSALS;

export type ConsumerContextRefusal = {
  readonly ok: false;
  readonly code: ConsumerContextRefusalCode;
  readonly status: number;
};

/** A context as consumer-context.mjs parses it: frozen, scope sorted, snapshot latest or pinned. */
export type ConsumerContext = {
  readonly schemaVersion: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly scope: readonly DeveloperScope[];
  readonly collectionId: string;
  readonly snapshot:
    | { readonly mode: "latest" }
    | { readonly mode: "pinned"; readonly version: string; readonly digest: string };
  readonly expiresAt?: string;
};

/** One World snapshot, named as lib/world-store.ts names it: the opaque world_state_id and its manifest digest. */
export type ConsumerSnapshot = { readonly worldStateId: string; readonly manifestDigest: string };

/**
 * What the route checks for itself: its own exact scope, and the collection id from its own path.
 * `null` is for a listing route whose path names no collection (GET /v1/collections): the bound
 * context's collection is then what the route narrows its answer to, never a widening.
 */
export type ConsumerContextRoute = { readonly scope: DeveloperScope; readonly collectionId: string | null };

/** No context and no required marker: the request is answered exactly as before. */
export type LegacyConsumerRequest = { readonly ok: true; readonly bound: false };

// Declared, never created. Only bindConsumerContext mints a BoundConsumerContext, so a snapshot
// resolution or an acknowledgement cannot be assembled from request headers or a hand-built context.
declare const BOUND: unique symbol;

export type BoundConsumerContext = {
  readonly ok: true;
  readonly bound: true;
  readonly context: ConsumerContext;
  /** Recomputed by the server from the validated fields. The request's identity header is never used. */
  readonly identity: string;
  readonly [BOUND]: true;
};

export type ConsumerContextBinding = LegacyConsumerRequest | BoundConsumerContext | ConsumerContextRefusal;

// Likewise only resolveConsumerSnapshot mints one, for the bound identity it resolved.
declare const RESOLVED: unique symbol;

export type ResolvedConsumerSnapshot = {
  readonly ok: true;
  /** The bound context this snapshot was resolved for. */
  readonly identity: string;
  readonly snapshot: ConsumerSnapshot;
  readonly [RESOLVED]: true;
};

export type SnapshotResolution = ResolvedConsumerSnapshot | ConsumerContextRefusal;

export type ConsumerContextAcknowledgement =
  | { readonly ok: true; readonly headers: Readonly<Record<string, string>> }
  | ConsumerContextRefusal;

// lib/world-store.ts's WORLD_STATE_ID and SHA256, which the client's snapshot patterns also are.
const WORLD_STATE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MANIFEST_DIGEST = /^sha256:[a-f0-9]{64}$/;

// The codes contextFromHeaders refuses with. Anything else it throws is still a refusal.
const PARSE_REFUSALS = new Set<string>([
  "CONSUMER_CONTEXT_INVALID",
  "CONSUMER_CONTEXT_SCHEMA_UNSUPPORTED",
  "CONSUMER_CONTEXT_IDENTITY_MISMATCH",
]);

const LEGACY: LegacyConsumerRequest = Object.freeze({ ok: true, bound: false });

function refusal(code: ConsumerContextRefusalCode): ConsumerContextRefusal {
  const refused: ConsumerContextRefusal = { ok: false, code, status: CONSUMER_CONTEXT_REFUSALS[code] };
  return Object.freeze(refused);
}

function parseRefusal(caught: unknown): ConsumerContextRefusal {
  const code = caught instanceof ConsumerContextError ? String(caught.code) : "";
  return refusal(PARSE_REFUSALS.has(code) ? (code as ConsumerContextRefusalCode) : "CONSUMER_CONTEXT_INVALID");
}

/** The id a context must name for this principal: the key for an API key, the user for a browser session. */
export function contextPrincipalId(principal: FoundationPrincipal): string | null {
  if (principal.kind === "api-key") return principal.keyId ?? null;
  if (principal.kind === "session") return principal.userId;
  return null;
}

/**
 * Bind a request's consumer context to the principal that authorization already verified.
 *
 * No context and no marker is legacy. The marker with no context is CONSUMER_CONTEXT_REQUIRED. A
 * context is bound only when every field holds against the principal and the route: the tenant is
 * the principal's workspace, the principal is its key (API key) or its user (session), the route's
 * exact scope is in the context, that scope and every scope the context lists are ones the
 * principal actually holds, the collection is the one in the path (a listing route with no
 * collection in its path passes null and narrows to the context's), and the context has not expired.
 * A partial, tampered or unreadable context is refused, never read as legacy.
 */
export function bindConsumerContext(
  headers: Pick<Headers, "get">,
  principal: FoundationPrincipal,
  route: ConsumerContextRoute,
  now = Date.now(),
): ConsumerContextBinding {
  const marker = headers.get(CONTEXT_REQUIRED_MARKER.header);
  // One value demands a context. Any other value is a malformed control header, never a waiver.
  if (marker !== null && marker !== CONTEXT_REQUIRED_MARKER.value) return refusal("CONSUMER_CONTEXT_INVALID");
  let context: ConsumerContext | null;
  try {
    // Reads the context headers only, so the marker alone is null.
    context = contextFromHeaders((name: string) => headers.get(name));
  } catch (caught) {
    return parseRefusal(caught);
  }
  if (context === null) return marker === null ? LEGACY : refusal("CONSUMER_CONTEXT_REQUIRED");
  // Recomputed here rather than taken on contextFromHeaders' word. The claimed identity is
  // compared and dropped: it proves nothing, and it is not what an acknowledgement carries.
  const identity = contextIdentity(context);
  if (headers.get(CONTEXT_HEADERS.identity) !== identity) return refusal("CONSUMER_CONTEXT_IDENTITY_MISMATCH");
  if (context.tenantId !== principal.workspaceKey) return refusal("CONSUMER_CONTEXT_TENANT_MISMATCH");
  if (context.principalId !== contextPrincipalId(principal)) return refusal("CONSUMER_CONTEXT_PRINCIPAL_MISMATCH");
  if (!context.scope.includes(route.scope)) return refusal("CONSUMER_CONTEXT_SCOPE_DENIED");
  if (![route.scope, ...context.scope].every((scope) => principal.scopes.includes(scope))) {
    return refusal("CONSUMER_CONTEXT_SCOPE_NOT_GRANTED");
  }
  if (route.collectionId !== null && context.collectionId !== route.collectionId) {
    return refusal("CONSUMER_CONTEXT_COLLECTION_MISMATCH");
  }
  if (context.expiresAt !== undefined && now >= Date.parse(context.expiresAt)) return refusal("CONSUMER_CONTEXT_STALE");
  const bound = { ok: true, bound: true, context, identity } as BoundConsumerContext;
  return Object.freeze(bound);
}

/** Exact pair equality: the opaque world_state_id and the digest, both, compared as strings. */
export function sameSnapshot(left: ConsumerSnapshot, right: ConsumerSnapshot): boolean {
  return left.worldStateId === right.worldStateId && left.manifestDigest === right.manifestDigest;
}

// Routes pass values read from storage and payloads, so the shape is checked, not assumed.
function wellFormed(snapshot: ConsumerSnapshot | null | undefined): snapshot is ConsumerSnapshot {
  if (!snapshot) return false;
  return (
    typeof snapshot.worldStateId === "string" && WORLD_STATE_ID.test(snapshot.worldStateId) &&
    typeof snapshot.manifestDigest === "string" && MANIFEST_DIGEST.test(snapshot.manifestDigest)
  );
}

function pinOf(context: ConsumerContext): ConsumerSnapshot | null {
  return context.snapshot.mode === "pinned"
    ? { worldStateId: context.snapshot.version, manifestDigest: context.snapshot.digest }
    : null;
}

/**
 * The snapshot a bound context may be answered from. Latest is the collection's active World,
 * whichever that is now; pinned is answered only while its exact (world_state_id, digest) pair is
 * the active World. `history` -- promoted versions of the collection; the route passes the one
 * row getFoundationWorldVersion finds for the pin's exact world_state_id, or none -- only names a
 * refusal: the exact pair there is SUPERSEDED, its world_state_id there or active under another
 * digest is MISMATCH, anything else is UNKNOWN.
 */
export function resolveConsumerSnapshot(
  bound: BoundConsumerContext,
  active: ConsumerSnapshot,
  history: readonly ConsumerSnapshot[] = [],
): SnapshotResolution {
  if (!wellFormed(active)) return refusal("CONSUMER_CONTEXT_SNAPSHOT_UNRESOLVED");
  // The pair only, never the rest of whatever active-world row the route read.
  const snapshot: ConsumerSnapshot = Object.freeze({ worldStateId: active.worldStateId, manifestDigest: active.manifestDigest });
  const pin = pinOf(bound.context);
  if (pin === null || sameSnapshot(pin, snapshot)) {
    const resolved = { ok: true, identity: bound.identity, snapshot } as ResolvedConsumerSnapshot;
    return Object.freeze(resolved);
  }
  if (history.some((version) => sameSnapshot(version, pin))) return refusal("CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED");
  if ([snapshot, ...history].some((version) => version.worldStateId === pin.worldStateId)) {
    return refusal("CONSUMER_CONTEXT_SNAPSHOT_MISMATCH");
  }
  return refusal("CONSUMER_CONTEXT_SNAPSHOT_UNKNOWN");
}

/**
 * The response headers that acknowledge a bound context: the identity the server computed, and
 * the snapshot the response payload was actually built from -- which the route passes in from that
 * payload, never from the request. The payload pair must equal the pair resolved for this bound
 * context: for latest, a promotion between resolving and building is refused rather than
 * acknowledged as either World; for pinned, it must also be the exact pinned pair. Exactly these
 * three headers, nothing echoed; the route adds Cache-Control: no-store.
 */
export function acknowledgeConsumerContext(
  bound: BoundConsumerContext,
  resolved: ResolvedConsumerSnapshot,
  served: ConsumerSnapshot,
): ConsumerContextAcknowledgement {
  if (resolved.identity !== bound.identity || !wellFormed(resolved.snapshot) || !wellFormed(served)) {
    return refusal("CONSUMER_CONTEXT_SNAPSHOT_UNRESOLVED");
  }
  if (!sameSnapshot(resolved.snapshot, served)) return refusal("CONSUMER_CONTEXT_SNAPSHOT_MISMATCH");
  const pin = pinOf(bound.context);
  if (pin !== null && !sameSnapshot(pin, served)) return refusal("CONSUMER_CONTEXT_SNAPSHOT_MISMATCH");
  return Object.freeze({
    ok: true,
    headers: Object.freeze({
      [CONTEXT_HEADERS.identity]: bound.identity,
      [CONTEXT_HEADERS.snapshotVersion]: served.worldStateId,
      [CONTEXT_HEADERS.snapshotDigest]: served.manifestDigest,
    }),
  } as const);
}

/**
 * The refusal for a bound context whose World moved after it was resolved: a pin that is no longer
 * active is SUPERSEDED, and latest is MISMATCH -- the same code acknowledgeConsumerContext gives a
 * payload built from a World other than the resolved one. Either way the client retries.
 */
export function consumerSnapshotMoved(bound: BoundConsumerContext): ConsumerContextRefusal {
  return refusal(pinOf(bound.context) === null ? "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH" : "CONSUMER_CONTEXT_SNAPSHOT_SUPERSEDED");
}

/**
 * After the payload and every late check: the collection's active pair, read again, must still be
 * the resolved one. A World that moved away and back is the resolved pair again and is answered.
 */
export function reconfirmConsumerSnapshot(
  bound: BoundConsumerContext,
  resolved: ResolvedConsumerSnapshot,
  current: ConsumerSnapshot,
): { readonly ok: true } | ConsumerContextRefusal {
  if (resolved.identity !== bound.identity || !wellFormed(resolved.snapshot) || !wellFormed(current)) {
    return refusal("CONSUMER_CONTEXT_SNAPSHOT_UNRESOLVED");
  }
  return sameSnapshot(resolved.snapshot, current) ? { ok: true } : consumerSnapshotMoved(bound);
}

/** The (world_state_id, digest) pair of a store row or a payload block, and nothing else from it. */
export function snapshotOf(value: unknown): ConsumerSnapshot {
  const record = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  // Non-strings become "", which no snapshot pattern accepts, so a malformed block is UNRESOLVED.
  return Object.freeze({
    worldStateId: typeof record.worldStateId === "string" ? record.worldStateId : "",
    manifestDigest: typeof record.manifestDigest === "string" ? record.manifestDigest : "",
  });
}

/** World version rows (world-store's WorldVersionRow) as the pairs resolveConsumerSnapshot classifies a pin against. */
export function consumerSnapshotHistory(
  versions: readonly { readonly world_state_id: string; readonly manifest_digest: string }[],
): ConsumerSnapshot[] {
  return versions.map((version) => snapshotOf({ worldStateId: version.world_state_id, manifestDigest: version.manifest_digest }));
}

/**
 * The pair a World read model was built from, taken from the model itself: its digest, and the
 * world_state_id its own history binds to that digest. Null when the model says it is not the
 * active World -- the active pointer moved between resolving and building -- which the route
 * refuses as consumerSnapshotMoved rather than acknowledging either World.
 */
export function worldModelSnapshot(model: {
  readonly world: { readonly manifestDigest: string; readonly status: string };
  readonly history: readonly { readonly version: string; readonly manifestDigest: string; readonly status: string }[];
}): ConsumerSnapshot | null {
  if (model.world.status !== "active") return null;
  const entry = model.history.find((item) => item.manifestDigest === model.world.manifestDigest);
  if (entry && entry.status !== "active") return null;
  return snapshotOf({ worldStateId: entry?.version, manifestDigest: model.world.manifestDigest });
}

/* ---------------------------------------------------------------- route wiring (reads) */

/** A store, source or authorization failure: the existing helper's own code and status. */
export type ConsumerContextFailure = { readonly ok: false; readonly code: string; readonly status: number };

export type BoundSnapshot = {
  readonly ok: true;
  readonly resolved: ResolvedConsumerSnapshot;
  /** The active World row the resolution was made against, for the payload and the late checks. */
  readonly world: ActiveWorld;
};

function failure(code: string, status: number): ConsumerContextFailure {
  return Object.freeze({ ok: false, code, status });
}

// The statuses the search and ask routes already give these active-World read failures.
function activeReadFailure(code: string): ConsumerContextFailure {
  return failure(code, code === "ACTIVE_WORLD_NOT_FOUND" ? 409 : 503);
}

/**
 * Step 3: resolve a bound context against the collection's active World, read in the principal's
 * workspace -- or the row the route already read for its own payload, so both are one read. A pin
 * that is not active is classified by one exact lookup of its world_state_id in this workspace and
 * collection (getFoundationWorldVersion), never a scan of recent history: so a pin promoted long
 * ago is still SUPERSEDED, and a store failure is a failure, never UNKNOWN.
 */
export async function resolveBoundSnapshot(
  bound: BoundConsumerContext,
  workspaceKey: string,
  world?: ActiveWorld,
): Promise<BoundSnapshot | ConsumerContextRefusal | ConsumerContextFailure> {
  const collectionId = bound.context.collectionId;
  let active = world;
  if (!active) {
    const read = await getFoundationActiveWorld(workspaceKey, collectionId);
    if (!read.ok) return activeReadFailure(read.code);
    active = read.world;
  }
  if (active.collectionId !== undefined && active.collectionId !== collectionId) {
    return refusal("CONSUMER_CONTEXT_SNAPSHOT_UNRESOLVED");
  }
  let resolution = resolveConsumerSnapshot(bound, snapshotOf(active));
  const pin = pinOf(bound.context);
  if (pin !== null && !resolution.ok && resolution.code === "CONSUMER_CONTEXT_SNAPSHOT_UNKNOWN") {
    const lookup = await getFoundationWorldVersion(workspaceKey, collectionId, pin.worldStateId);
    if (!lookup.ok) return failure(lookup.code, 503);
    const history = lookup.found ? consumerSnapshotHistory([lookup.version]) : [];
    resolution = resolveConsumerSnapshot(bound, snapshotOf(active), history);
  }
  if (!resolution.ok) return resolution;
  return Object.freeze({ ok: true, resolved: resolution, world: active });
}

/**
 * Step 5: release a bound response, or refuse it. In order: the payload's pair must be the resolved
 * pair; the principal is re-resolved with the route's own scope (developer-auth's
 * revalidateFoundationAuthorization); the resolved World's sources must still be admitted
 * (connector access and derived-data admission, as Ask checks them); and the active World, read
 * once more, must still be the resolved one. Only then are the acknowledgement headers returned,
 * with Cache-Control: no-store. Nothing is cached on the way.
 */
export async function releaseConsumerContext(input: {
  readonly request: Request;
  readonly principal: FoundationPrincipal;
  readonly scope: DeveloperScope;
  readonly bound: BoundConsumerContext;
  readonly snapshot: BoundSnapshot;
  /** What the payload was built from, read from the payload. Null: the payload says it is not active. */
  readonly served: ConsumerSnapshot | null;
  readonly minimumPlan?: "observer" | "studio";
}): Promise<{ readonly ok: true; readonly headers: Readonly<Record<string, string>> } | ConsumerContextRefusal | ConsumerContextFailure> {
  const { request, principal, scope, bound, snapshot, served } = input;
  const workspaceKey = principal.workspaceKey;
  const collectionId = bound.context.collectionId;
  if (served === null) return consumerSnapshotMoved(bound);
  if (!sameSnapshot(snapshot.resolved.snapshot, snapshotOf(snapshot.world))) return refusal("CONSUMER_CONTEXT_SNAPSHOT_UNRESOLVED");
  const acknowledged = acknowledgeConsumerContext(bound, snapshot.resolved, served);
  if (!acknowledged.ok) return acknowledged;

  const authorized = await revalidateFoundationAuthorization(request, principal, scope, input.minimumPlan ?? "observer");
  if (!authorized.ok) return failure(authorized.code, authorized.status);

  const sources = await loadActiveWorldSourceIds(workspaceKey, collectionId, snapshot.world);
  if (!sources.ok) return failure(sources.code, 503);
  const access = await checkConnectorSourceAccess(workspaceKey, sources.documentIds);
  if (!access.ok) return failure(access.code, access.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503);
  if (!await admitsDerivedCustomerData(workspaceKey, sources.documentIds)) return failure(DERIVED_DATA_REFUSED, 403);

  const current = await getFoundationActiveWorld(workspaceKey, collectionId);
  // No active World any more is the resolved one gone, not an outage.
  if (!current.ok) return current.code === "ACTIVE_WORLD_NOT_FOUND" ? consumerSnapshotMoved(bound) : failure(current.code, 503);
  const confirmed = reconfirmConsumerSnapshot(bound, snapshot.resolved, snapshotOf(current.world));
  if (!confirmed.ok) return confirmed;
  return Object.freeze({ ok: true, headers: Object.freeze({ ...acknowledged.headers, "Cache-Control": "no-store" }) });
}
