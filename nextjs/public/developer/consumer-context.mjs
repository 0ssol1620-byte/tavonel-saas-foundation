/**
 * Consumer context for the TAVONEL CLI and MCP server.
 *
 * A consumer context binds every API read an agent or script makes to one tenant, one principal,
 * an explicit scope list, one collection and one snapshot -- the latest active World, or a pinned
 * version plus its manifest digest. The binding is frozen once parsed, travels with each request
 * as headers, and has one deterministic identity that is also the cache identity.
 *
 *   TAVONEL_CONSUMER_CONTEXT='{"schemaVersion":"tavonel.consumer_context.v1", ...}'
 *   TAVONEL_CONSUMER_CONTEXT_REQUIRED=true      (refuse every API read without a usable context)
 *
 * Unless a nonblank context is supplied or the required flag is neither blank nor false (trimmed,
 * any case), the CLI and MCP server do not load this file and behave exactly as before; an invalid
 * flag loads it and is refused. A context that is supplied but unusable is refused, never silently
 * dropped. A required binding also sends a one-way marker header, so an API can tell a required
 * context that never arrived from a legacy request that had none.
 *
 * ENFORCEMENT SCOPE: what is enforced here is local, client-side refusal plus header propagation.
 * The server half is `lib/consumer-context-api.ts`, and the API route handlers for the World reads
 * (including GET /v1/collections/{id}/world), discovery and Search/Ask now call it: they bind the
 * context to the authorized principal, resolve its snapshot, revalidate before release and only
 * then acknowledge. That wiring is exercised only in `lib/consumer-context/consumer-context-parity.test.ts`,
 * against the actual exported handlers with authorization, storage, source admission and retrieval
 * replaced by synthetic collaborators, and the code has not been deployed. This is local synthetic
 * evidence only, not production API support: there is no production evidence that the API reads or
 * acknowledges these headers, and TAVONEL_CONSUMER_CONTEXT_REQUIRED=true against an API that does
 * not acknowledge them fails closed with CONSUMER_CONTEXT_NOT_ACKNOWLEDGED.
 */

import { createHash } from "node:crypto";

export const CONSUMER_CONTEXT_SCHEMA_VERSION = "tavonel.consumer_context.v1";
export const CONSUMER_CONTEXT_ENV = "TAVONEL_CONSUMER_CONTEXT";
export const CONSUMER_CONTEXT_REQUIRED_ENV = "TAVONEL_CONSUMER_CONTEXT_REQUIRED";

export const CONSUMER_CONTEXT_ENFORCEMENT = Object.freeze({
  evidence: "local-synthetic",
  productionApiSupport: false,
  statement:
    "Consumer-context enforcement is local synthetic evidence only, not production API support. " +
    "The production API does not validate or acknowledge consumer-context headers.",
});

export const CONTEXT_HEADERS = Object.freeze({
  schema: "x-tavonel-consumer-context-schema",
  identity: "x-tavonel-consumer-context-identity",
  tenant: "x-tavonel-tenant-id",
  principal: "x-tavonel-principal-id",
  scope: "x-tavonel-consumer-scope",
  collection: "x-tavonel-collection-id",
  snapshotMode: "x-tavonel-snapshot-mode",
  snapshotVersion: "x-tavonel-snapshot-version",
  snapshotDigest: "x-tavonel-snapshot-digest",
  expiresAt: "x-tavonel-consumer-context-expires-at",
});

/*
 * The one control header, deliberately outside CONTEXT_HEADERS: it is no part of a context, its
 * identity or its cache key. A required binding sends it with every request; nothing acknowledges
 * or echoes it; it can only demand a context, never waive one. An API that receives it without a
 * context refuses CONSUMER_CONTEXT_REQUIRED instead of answering the request as legacy.
 */
export const CONTEXT_REQUIRED_MARKER = Object.freeze({ header: "x-tavonel-consumer-context-required", value: "true" });

/*
 * Explicit scopes only: no wildcard, no implied scope. These are the server's DeveloperScope names
 * (lib/developer-contracts.ts) and each mapped request needs exactly the scope its route checks.
 * Sharing the names is not server support: the production API has no consumer-context support
 * today -- it neither enforces nor acknowledges a context.
 */
export const CONSUMER_SCOPES = Object.freeze([
  "documents:read",
  "documents:intake",
  "collections:read",
  "collections:compile",
  "collections:download",
  "worlds:read",
  "ask:read",
  "connections:read",
  "connections:write",
  "connections:sync",
]);

const REQUIRED_FIELDS = ["schemaVersion", "tenantId", "principalId", "scope", "collectionId", "snapshot"];
const KNOWN_FIELDS = new Set([...REQUIRED_FIELDS, "expiresAt"]);
// A tenant is a Foundation workspace key: lib/immutable-keys.ts WORKSPACE_ID_PATTERN, restated
// because this file is published standalone. Case is significant; nothing here folds it.
const TENANT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const PRINCIPAL_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const COLLECTION_ID = /^collection-[a-f0-9]{32}$/;
const COLLECTION_IN_PATH = /collection-[a-f0-9]{32}/;
// An opaque world_state_id, as lib/world-store.ts accepts one; numeric versions still match.
const SNAPSHOT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SNAPSHOT_DIGEST = /^sha256:[a-f0-9]{64}$/;

export class ConsumerContextError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = "ConsumerContextError";
    this.code = code;
  }
}

function refuse(code, detail) {
  throw new ConsumerContextError(code, detail);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** Parse and freeze a context. Strict: unknown fields, missing fields and ambiguity are refused. */
export function parseConsumerContext(input) {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      refuse("CONSUMER_CONTEXT_INVALID", "context is not valid json");
    }
  }
  if (!plainObject(value)) refuse("CONSUMER_CONTEXT_INVALID", "context must be a json object");
  for (const key of Object.keys(value)) {
    if (!KNOWN_FIELDS.has(key)) refuse("CONSUMER_CONTEXT_INVALID", `unknown field ${key}`);
  }
  for (const key of REQUIRED_FIELDS) {
    if (value[key] === undefined || value[key] === null) refuse("CONSUMER_CONTEXT_INVALID", `${key} is required`);
  }
  if (value.schemaVersion !== CONSUMER_CONTEXT_SCHEMA_VERSION) {
    refuse("CONSUMER_CONTEXT_SCHEMA_UNSUPPORTED", `schemaVersion must be ${CONSUMER_CONTEXT_SCHEMA_VERSION}`);
  }
  for (const [key, pattern] of [["tenantId", TENANT_ID], ["principalId", PRINCIPAL_ID]]) {
    if (typeof value[key] !== "string" || !pattern.test(value[key])) refuse("CONSUMER_CONTEXT_INVALID", `${key} is not an id`);
  }
  if (!Array.isArray(value.scope) || value.scope.length === 0) refuse("CONSUMER_CONTEXT_INVALID", "scope must be a non-empty list");
  for (const entry of value.scope) {
    if (!CONSUMER_SCOPES.includes(entry)) refuse("CONSUMER_CONTEXT_INVALID", `scope ${String(entry)} is not an explicit scope`);
  }
  if (new Set(value.scope).size !== value.scope.length) refuse("CONSUMER_CONTEXT_INVALID", "scope lists an entry twice");
  if (typeof value.collectionId !== "string" || !COLLECTION_ID.test(value.collectionId)) {
    refuse("CONSUMER_CONTEXT_INVALID", "collectionId is not a collection id");
  }
  const snapshot = value.snapshot;
  if (!plainObject(snapshot)) refuse("CONSUMER_CONTEXT_INVALID", "snapshot must be an object");
  for (const key of Object.keys(snapshot)) {
    if (!["mode", "version", "digest"].includes(key)) refuse("CONSUMER_CONTEXT_INVALID", `unknown snapshot field ${key}`);
  }
  let boundSnapshot;
  if (snapshot.mode === "latest") {
    // A latest context that also names a version is two answers to one question.
    if (snapshot.version !== undefined || snapshot.digest !== undefined) {
      refuse("CONSUMER_CONTEXT_INVALID", "a latest snapshot cannot carry a version or digest");
    }
    boundSnapshot = { mode: "latest" };
  } else if (snapshot.mode === "pinned") {
    if (typeof snapshot.version !== "string" || !SNAPSHOT_VERSION.test(snapshot.version)) {
      refuse("CONSUMER_CONTEXT_INVALID", "a pinned snapshot requires a version");
    }
    if (typeof snapshot.digest !== "string" || !SNAPSHOT_DIGEST.test(snapshot.digest)) {
      refuse("CONSUMER_CONTEXT_INVALID", "a pinned snapshot requires a sha256 digest");
    }
    boundSnapshot = { mode: "pinned", version: snapshot.version, digest: snapshot.digest };
  } else {
    refuse("CONSUMER_CONTEXT_INVALID", "snapshot mode must be latest or pinned");
  }
  if (value.expiresAt !== undefined && (typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)))) {
    refuse("CONSUMER_CONTEXT_INVALID", "expiresAt must be an iso timestamp");
  }
  return deepFreeze({
    schemaVersion: value.schemaVersion,
    tenantId: value.tenantId,
    principalId: value.principalId,
    scope: [...value.scope].sort(),
    collectionId: value.collectionId,
    snapshot: boundSnapshot,
    ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt } : {}),
  });
}

/**
 * The deterministic identity: tenant, principal, scope, collection and snapshot, nothing else.
 * Field order and scope order in the source JSON do not change it; expiry does not either.
 */
export function contextIdentity(context) {
  const canonical = JSON.stringify([
    context.schemaVersion,
    context.tenantId,
    context.principalId,
    [...context.scope].sort(),
    context.collectionId,
    context.snapshot.mode,
    context.snapshot.version ?? null,
    context.snapshot.digest ?? null,
  ]);
  return `ctx1-${sha256(canonical)}`;
}

/**
 * The cache key for one response. A latest context is cacheable only together with the snapshot
 * the API resolved it to, so a promotion can never be answered from the previous World's cache.
 *
 * @param {{ snapshot: { mode: string, version?: string, digest?: string } }} context a parsed context
 * @param {{ method?: string, path?: string, body?: unknown }} [request] the request answered; body is
 *   a string or a JSON value, null or absent for none
 * @param {{ version?: string, digest?: string }} [resolved] the snapshot the API resolved the context to
 */
export function cacheKey(context, { method = "GET", path, body } = {}, resolved) {
  const snapshot = context.snapshot.mode === "pinned" ? context.snapshot : resolved;
  // A string check first: String(undefined) would pass the opaque version pattern.
  if (!snapshot || typeof snapshot.version !== "string" || !SNAPSHOT_VERSION.test(snapshot.version) || !SNAPSHOT_DIGEST.test(String(snapshot.digest))) {
    refuse("CONSUMER_CONTEXT_CACHE_UNRESOLVED", "a latest context is cacheable only with its resolved snapshot");
  }
  if (context.snapshot.mode === "pinned" && resolved && (resolved.version !== snapshot.version || resolved.digest !== snapshot.digest)) {
    refuse("CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", "resolved snapshot differs from the pinned snapshot");
  }
  const bodyText = body === undefined || body === null ? null : typeof body === "string" ? body : JSON.stringify(body);
  return `cc1-${sha256(JSON.stringify([contextIdentity(context), snapshot.version, snapshot.digest, method.toUpperCase(), path, bodyText]))}`;
}

/** The headers a context travels as. */
export function contextHeaders(context) {
  return {
    [CONTEXT_HEADERS.schema]: context.schemaVersion,
    [CONTEXT_HEADERS.identity]: contextIdentity(context),
    [CONTEXT_HEADERS.tenant]: context.tenantId,
    [CONTEXT_HEADERS.principal]: context.principalId,
    [CONTEXT_HEADERS.scope]: context.scope.join(" "),
    [CONTEXT_HEADERS.collection]: context.collectionId,
    [CONTEXT_HEADERS.snapshotMode]: context.snapshot.mode,
    ...(context.snapshot.mode === "pinned"
      ? { [CONTEXT_HEADERS.snapshotVersion]: context.snapshot.version, [CONTEXT_HEADERS.snapshotDigest]: context.snapshot.digest }
      : {}),
    ...(context.expiresAt !== undefined ? { [CONTEXT_HEADERS.expiresAt]: context.expiresAt } : {}),
  };
}

/**
 * Rebuild a context from request headers, for an API boundary. Returns null when no context
 * header is present -- the required marker is control, not context, so a marker alone is still
 * null, for the API to refuse as required-missing; refuses a partial context and a claimed
 * identity that does not match.
 */
export function contextFromHeaders(get) {
  const read = (name) => {
    const value = get(name);
    return value === undefined || value === null ? null : String(value);
  };
  if (Object.values(CONTEXT_HEADERS).every((name) => read(name) === null)) return null;
  const mode = read(CONTEXT_HEADERS.snapshotMode);
  const version = read(CONTEXT_HEADERS.snapshotVersion);
  const digest = read(CONTEXT_HEADERS.snapshotDigest);
  const scope = read(CONTEXT_HEADERS.scope);
  const expiresAt = read(CONTEXT_HEADERS.expiresAt);
  const context = parseConsumerContext({
    schemaVersion: read(CONTEXT_HEADERS.schema) ?? undefined,
    tenantId: read(CONTEXT_HEADERS.tenant) ?? undefined,
    principalId: read(CONTEXT_HEADERS.principal) ?? undefined,
    scope: scope === null ? undefined : scope.split(" ").filter(Boolean),
    collectionId: read(CONTEXT_HEADERS.collection) ?? undefined,
    snapshot: {
      mode: mode ?? undefined,
      ...(version !== null ? { version } : {}),
      ...(digest !== null ? { digest } : {}),
    },
    ...(expiresAt !== null ? { expiresAt } : {}),
  });
  if (read(CONTEXT_HEADERS.identity) !== contextIdentity(context)) {
    refuse("CONSUMER_CONTEXT_IDENTITY_MISMATCH", "claimed identity does not match the bound fields");
  }
  return context;
}

/** The one explicit scope an API path needs -- the scope its server route checks -- or null when unmapped. */
export function requiredScope(method, path) {
  const verb = String(method ?? "GET").toUpperCase();
  const pathname = String(path).split("?")[0];
  if (pathname === "/api/v1/documents") return verb === "GET" ? "documents:read" : null;
  if (pathname === "/api/v1/connections" || pathname.startsWith("/api/v1/connections/")) {
    if (verb === "GET") return "connections:read";
    return verb === "POST" && /^\/api\/v1\/connections\/[^/]+\/sync$/.test(pathname) ? "connections:sync" : "connections:write";
  }
  if (pathname === "/api/v1/collections/compile") return verb === "POST" ? "collections:compile" : null;
  if (pathname.startsWith("/api/v1/world/")) return verb === "GET" ? "worlds:read" : null;
  if (pathname.startsWith("/api/v1/collections")) {
    if (verb === "POST" && /\/(search|ask)$/.test(pathname)) return "ask:read";
    if (verb === "GET" && pathname.endsWith("/download")) return "collections:download";
    if (verb === "GET" && pathname.endsWith("/world")) return "worlds:read";
    if (verb === "GET") return "collections:read";
  }
  return null;
}

/** Local refusals, before anything reaches the network. */
export function assertRequestAllowed(context, request, now = Date.now()) {
  if (context.expiresAt !== undefined && now >= Date.parse(context.expiresAt)) {
    refuse("CONSUMER_CONTEXT_STALE", `context expired at ${context.expiresAt}`);
  }
  const scope = requiredScope(request.method, request.path);
  if (scope === null) refuse("CONSUMER_CONTEXT_SCOPE_UNMAPPED", `no consumer scope covers ${request.method ?? "GET"} ${request.path}`);
  if (!context.scope.includes(scope)) refuse("CONSUMER_CONTEXT_SCOPE_DENIED", `context does not hold ${scope}`);
  const pathCollection = String(request.path).split("?")[0].match(COLLECTION_IN_PATH)?.[0];
  if (pathCollection !== undefined && pathCollection !== context.collectionId) {
    refuse("CONSUMER_CONTEXT_COLLECTION_MISMATCH", "request names a collection other than the bound one");
  }
  return true;
}

/**
 * Check what the API acknowledged. A wrong acknowledgement is always refused; a missing one is
 * refused when the context is required, because an unacknowledged context is an unenforced one.
 */
export function verifyResponseContext(context, response, { required = false } = {}) {
  const get = (name) => response.headers.get(name);
  const echoed = get(CONTEXT_HEADERS.identity);
  if (echoed === null) {
    if (required) refuse("CONSUMER_CONTEXT_NOT_ACKNOWLEDGED", "the api did not acknowledge the consumer context");
    return Object.freeze({ acknowledged: false, snapshot: null });
  }
  if (echoed !== contextIdentity(context)) refuse("CONSUMER_CONTEXT_MISMATCH", "the api acknowledged a different context");
  const version = get(CONTEXT_HEADERS.snapshotVersion);
  const digest = get(CONTEXT_HEADERS.snapshotDigest);
  if (version === null || digest === null || !SNAPSHOT_VERSION.test(version) || !SNAPSHOT_DIGEST.test(digest)) {
    refuse("CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", "acknowledgement carries no resolved snapshot");
  }
  if (context.snapshot.mode === "pinned" && (version !== context.snapshot.version || digest !== context.snapshot.digest)) {
    refuse("CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", "the api answered from a snapshot other than the pinned one");
  }
  return Object.freeze({ acknowledged: true, snapshot: Object.freeze({ version, digest }) });
}

/**
 * The binding the CLI and MCP client use. Null means legacy: no context configured and none
 * required. Otherwise every request goes through prepare() and every 2xx through verify(); a
 * binding that could not be built refuses both. A required binding's prepare() adds the required
 * marker to the context headers.
 */
export function createConsumerContextBinding({ env = process.env, now = () => Date.now() } = {}) {
  const raw = env[CONSUMER_CONTEXT_ENV];
  // Trimmed, any case; blank or false is off. The CLI and MCP apply this same rule before they
  // import this file, so an off flag never loads it and an invalid one is refused here.
  const flag = String(env[CONSUMER_CONTEXT_REQUIRED_ENV] ?? "").trim().toLowerCase();
  const supplied = typeof raw === "string" && raw.trim().length > 0;
  let required = false;
  let error = null;
  if (flag === "true") required = true;
  else if (flag !== "" && flag !== "false") {
    required = true;
    error = new ConsumerContextError("CONSUMER_CONTEXT_REQUIRED_FLAG_INVALID", `${CONSUMER_CONTEXT_REQUIRED_ENV} must be true or false`);
  }
  if (!supplied && !required) return null;
  let context = null;
  if (!error && !supplied) {
    error = new ConsumerContextError("CONSUMER_CONTEXT_REQUIRED", `${CONSUMER_CONTEXT_REQUIRED_ENV}=true but ${CONSUMER_CONTEXT_ENV} is not set`);
  } else if (!error) {
    try {
      context = parseConsumerContext(raw);
    } catch (caught) {
      error = caught instanceof ConsumerContextError ? caught : new ConsumerContextError("CONSUMER_CONTEXT_INVALID", "context is unreadable");
    }
  }
  return Object.freeze({
    required,
    context,
    error,
    identity: context ? contextIdentity(context) : null,
    prepare(request) {
      if (error) throw error;
      assertRequestAllowed(context, request, now());
      const headers = contextHeaders(context);
      return required ? { ...headers, [CONTEXT_REQUIRED_MARKER.header]: CONTEXT_REQUIRED_MARKER.value } : headers;
    },
    verify(request, response) {
      if (error) throw error;
      return verifyResponseContext(context, response, { required });
    },
  });
}
