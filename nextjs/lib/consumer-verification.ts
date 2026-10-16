import { COLLECTION_ID_PATTERN } from "./immutable-keys";

/*
  Customer-triggered API query verification (UX14).

  One explicit request, made by the customer with a key they already hold, to the Ask route that
  already exists: POST /api/v1/collections/{id}/ask, which delegates to the authorized
  /api/collections/{id}/ask handler. Nothing here mints, reads, copies or revokes a key, and
  nothing here calls a status route: /api/status/v2 is public and proves neither authentication
  nor retrieval, and there is no /api/v1/status.

  What a verified answer shows, and what it does not:
    * it shows that this key was accepted for ask:read, and that the response it got back is
      bound to the collection that was asked and to the manifest of the World that answered;
    * it does not show that the MCP bridge or the CLI is connected, and it is no judgment of
      whether the answer is correct. The answer is the cited excerpts (answerMode
      "evidence_excerpts"); no model wrote it.

  The response is read against the two builders in lib/grounded-ask.ts -- GroundedAnswer for
  the excerpt fallback and PacketAnswer for the compiled path -- and against the route's own
  envelope (code, retrievalPath, answerMode, activeWorld). Each path is checked for the fields
  it actually carries: a compiled citation has no sourceId and may have no page or region, and
  is not asked for them. Only the fields this view renders are kept; everything else in the body
  (the ContextPacket, diagnostics, freshness, anything unknown) is dropped unread.
*/

/** The one route this view calls. A literal, same-origin path; the id is pattern-checked first. */
export function askEndpoint(collectionId: string): string {
  return `/api/v1/collections/${encodeURIComponent(collectionId)}/ask`;
}

/** A finite deadline for the single request; past it the request is aborted and abandoned. */
export const VERIFICATION_DEADLINE_MS = 20_000;

// The route's own request bounds (app/api/collections/[id]/ask/route.ts).
const QUESTION_MIN_CHARACTERS = 3;
const QUESTION_MAX_CHARACTERS = 500;
const ASK_BODY_BYTE_LIMIT = 2_048;

// grounded-ask.ts's answer envelopes and citation preview length, restated rather than imported:
// that module pulls node:crypto and the packet verifier, neither of which belongs in a browser.
const FALLBACK_ANSWER_CHARACTER_LIMIT = 3 * 420 + 2 * 2;
const COMPILED_ANSWER_CHARACTER_LIMIT = 10 * 420 + 9 * 2;
const EXCERPT_CHARACTER_LIMIT = 420;
const FALLBACK_RECEIPT_RETRIEVAL = "adaptive-multilingual-region-v2";
const EVIDENCE_EXCEEDS_ANSWER_LIMIT = "EVIDENCE_EXCEEDS_ANSWER_LIMIT";

// lib/world-store.ts's WORLD_STATE_ID and SHA256, as consumer-context-api.ts restates them.
const WORLD_STATE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

// Browser-side bounds on what this view will read and render. Not API contract.
const MAX_RESPONSE_CHARACTERS = 4 * 1024 * 1024;
const MAX_ERROR_BODY_CHARACTERS = 16_384;
const MAX_RENDERED_CITATIONS = 50;
const MAX_OPAQUE_ID_CHARACTERS = 512;

export type RetrievalPath = "compiled-retrieval-v1" | "excerpt-concatenation-fallback";
export type AbstentionReason =
  | "NO_REGION_BOUND_EVIDENCE_MATCH"
  | "EVIDENCE_EXCEEDS_ANSWER_LIMIT"
  | "CITED_EVIDENCE_NOT_IN_PACKET"
  | "OTHER";

const KNOWN_ABSTENTION_REASONS = new Set<string>([
  "NO_REGION_BOUND_EVIDENCE_MATCH",
  EVIDENCE_EXCEEDS_ANSWER_LIMIT,
  "CITED_EVIDENCE_NOT_IN_PACKET",
]);

export type VerifiedCitation = {
  readonly evidenceId: string;
  /** Fallback citations name their source; compiled citations do not carry one. */
  readonly sourceId: string | null;
  readonly sourceVersionId: string;
  /** Compiled citations name the retrieval unit; fallback citations have none. */
  readonly unitId: string | null;
  readonly pageNumber1: number | null;
  readonly bbox1000: readonly [number, number, number, number] | null;
  readonly excerpt: string;
};

export type VerificationReceipt = {
  readonly outcome: "evidence" | "abstained";
  readonly code: "GROUNDED_ANSWER" | "ANSWER_ABSTAINED";
  readonly retrievalPath: RetrievalPath;
  readonly answerMode: "evidence_excerpts";
  /** The returned answer text; always "" for an abstention. */
  readonly answer: string;
  readonly abstentionReason: AbstentionReason | null;
  readonly citations: readonly VerifiedCitation[];
  readonly activeWorld: { readonly worldStateId: string; readonly manifestDigest: string; readonly revision: number };
  readonly receipt: { readonly collectionId: string; readonly manifestDigest: string; readonly outputSha256: string };
};

/** Every refusal this view can show. Local codes only; a server code is shown only if allowlisted. */
export type RefusalCode =
  | "API_KEY_MISSING"
  | "API_KEY_INVALID"
  | "API_KEY_NOT_SCOPED_KEY"
  | "COLLECTION_ID_INVALID"
  | "QUESTION_LENGTH"
  | "QUESTION_TOO_LARGE"
  | "NETWORK_FAILURE"
  | "DEADLINE_EXCEEDED"
  | "CANCELLED"
  | "RESPONSE_NOT_JSON"
  | "RESPONSE_TOO_LARGE"
  | "MALFORMED_SUCCESS"
  | "COLLECTION_MISMATCH"
  | "MANIFEST_MISMATCH"
  | "AUTHENTICATION_REFUSED"
  | "ACCESS_REFUSED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "REQUEST_REFUSED"
  | "SERVICE_UNAVAILABLE"
  | "UNEXPECTED_STATUS";

export type VerificationRefusal = {
  readonly code: RefusalCode;
  /** The route's code, only when it is one of the codes below. Never an arbitrary body value. */
  readonly serverCode: string | null;
  readonly status: number | null;
};

export type VerificationState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "evidence"; readonly receipt: VerificationReceipt }
  | { readonly kind: "abstained"; readonly receipt: VerificationReceipt }
  | { readonly kind: "refused"; readonly refusal: VerificationRefusal };

const REFUSAL_COPY: Record<RefusalCode, string> = {
  API_KEY_MISSING: "Enter an API key that has already been issued.",
  API_KEY_INVALID: "The key contains control characters. Paste it exactly as it was issued.",
  API_KEY_NOT_SCOPED_KEY: "Enter a scoped API key (tvnl_live_...). A browser session cannot be used for this check.",
  COLLECTION_ID_INVALID: "The collection ID must be collection- followed by 32 lowercase hexadecimal characters.",
  QUESTION_LENGTH: "The question must be 3 to 500 characters.",
  QUESTION_TOO_LARGE: "The question is too large for one Ask request.",
  NETWORK_FAILURE: "The request could not be completed. Nothing was verified.",
  DEADLINE_EXCEEDED: "No response arrived within 20 seconds. The request was abandoned and nothing was verified.",
  CANCELLED: "The request was cancelled. A late response will be ignored.",
  RESPONSE_NOT_JSON: "The API returned a success status with a body that is not JSON. Nothing was verified.",
  RESPONSE_TOO_LARGE: "The response was too large to verify in this browser. Nothing is shown.",
  MALFORMED_SUCCESS: "The API returned a success status, but the body did not match the Ask contract. Nothing is shown.",
  COLLECTION_MISMATCH: "The receipt names a different collection from the one asked. Nothing is shown.",
  MANIFEST_MISMATCH: "The receipt's manifest is not the manifest of the World that answered. Nothing is shown.",
  AUTHENTICATION_REFUSED: "The key was not accepted.",
  ACCESS_REFUSED: "Access was refused. Key authentication was not verified.",
  CONFLICT: "The collection's World could not be read for this question right now.",
  RATE_LIMITED: "The Ask allowance is used up for now. Wait a minute and try again.",
  REQUEST_REFUSED: "The API refused the request.",
  SERVICE_UNAVAILABLE: "The API could not answer right now. Nothing was verified.",
  UNEXPECTED_STATUS: "The API returned a status this view does not accept as an answer. Nothing was verified.",
};

// Codes the Ask route and its authorization actually return, each with a sentence of our own.
const SERVER_REFUSAL_COPY = new Map<string, string>([
  ["AUTH_REQUIRED", "The key was not recognized. Check that it was issued and has not been revoked."],
  ["API_SCOPE_REQUIRED", "The key does not hold the ask:read scope."],
  ["API_KEY_AUTHORIZATION_REVOKED", "The key's authorization was withdrawn when workspace access changed."],
  ["AUTHORIZATION_CHANGED_RETRY", "Authorization changed while the request ran, so nothing was released."],
  ["PILOT_ACCESS_REQUIRED", "The key's owner does not have access to this product."],
  ["WORKSPACE_MEMBERSHIP_REQUIRED", "The key's owner is no longer an active member of the workspace."],
  ["API_RATE_LIMITED", "The key's ask:read allowance for this minute is used up."],
  ["WORKSPACE_CONCURRENCY_LIMIT", "Too many Ask requests are already running in this workspace."],
  ["COLLECTION_ID_INVALID", "The API did not accept the collection ID."],
  ["QUESTION_INVALID", "The API did not accept the question."],
  ["RETRIEVAL_QUESTION_INVALID", "The API did not accept the question."],
  ["QUESTION_TOO_LARGE", "The API refused the question as too large."],
  ["INVALID_JSON", "The API could not read the request body."],
  ["ACTIVE_WORLD_NOT_FOUND", "This collection has no active World to answer from."],
  ["ACTIVE_WORLD_CHANGED_RETRY", "The active World changed while answering, so the answer was withheld."],
  ["ACTIVE_WORLD_ARTIFACT_INVALID", "The active World could not be read for retrieval."],
  ["ACTIVE_WORLD_RETRIEVAL_INVALID", "The active World could not be read for retrieval."],
  ["CONNECTOR_SOURCE_ACCESS_DENIED", "The key's owner cannot read one of this World's sources."],
  ["RETRIEVAL_RUNTIME_UNAVAILABLE", "Retrieval is unavailable right now."],
  ["SIGNER_NOT_CONFIGURED", "Retrieval is unavailable right now."],
]);

const ABSTENTION_COPY: Record<AbstentionReason, string> = {
  NO_REGION_BOUND_EVIDENCE_MATCH: "No region-bound evidence matched the question.",
  EVIDENCE_EXCEEDS_ANSWER_LIMIT: "Matching evidence was found, but it is too long to return as one complete answer. The cited regions are listed instead.",
  CITED_EVIDENCE_NOT_IN_PACKET: "A citation could not be verified against the retrieved evidence, so nothing was returned.",
  OTHER: "The API abstained for a reason this view does not describe.",
};

export function refusalSentence(refusal: VerificationRefusal): string {
  return (refusal.serverCode && SERVER_REFUSAL_COPY.get(refusal.serverCode)) || REFUSAL_COPY[refusal.code];
}

export function abstentionSentence(reason: AbstentionReason | null): string {
  return ABSTENTION_COPY[reason ?? "OTHER"];
}

export function retrievalPathLabel(path: RetrievalPath): string {
  return path === "compiled-retrieval-v1"
    ? "Compiled retrieval index (compiled-retrieval-v1)"
    : "Excerpt fallback: no compiled index answered for this World (excerpt-concatenation-fallback)";
}

export function describeVerificationState(state: VerificationState): string {
  if (state.kind === "idle") return "Nothing has been sent. The API is called only when you send the request below.";
  if (state.kind === "pending") return "Sending one Ask request to the API.";
  if (state.kind === "evidence") return "The API answered with evidence-bound excerpts for this collection.";
  if (state.kind === "abstained") {
    return state.receipt.abstentionReason === EVIDENCE_EXCEEDS_ANSWER_LIMIT
      ? "The API answered but abstained: no answer text was returned."
      : "The API answered without supporting evidence: it abstained and returned no answer.";
  }
  return refusalSentence(state.refusal);
}

/* ------------------------------------------------------------------ request */

export type VerificationInput = { readonly apiKey: string; readonly collectionId: string; readonly question: string };

export type CheckedRequest = {
  readonly ok: true;
  readonly collectionId: string;
  readonly apiKey: string;
  readonly body: string;
};

/**
 * Check the three inputs before anything is sent. The collection and question use the route's own
 * rules. The key is only checked for being present, free of control characters, and a scoped API
 * key at all: `tvnl_live_` is the prefix on which developer-auth.ts chooses the API-key path, and
 * without it the route would authenticate the bearer as a browser session instead. Whether the key
 * is valid, unrevoked and scoped is the server's to say.
 */
export function checkVerificationRequest(input: VerificationInput): CheckedRequest | { readonly ok: false; readonly code: RefusalCode } {
  const { apiKey, collectionId, question } = input;
  if (typeof collectionId !== "string" || !COLLECTION_ID_PATTERN.test(collectionId)) return { ok: false, code: "COLLECTION_ID_INVALID" };
  if (typeof apiKey !== "string" || apiKey.trim() === "") return { ok: false, code: "API_KEY_MISSING" };
  if (CONTROL_CHARACTER.test(apiKey)) return { ok: false, code: "API_KEY_INVALID" };
  if (!apiKey.startsWith("tvnl_live_")) return { ok: false, code: "API_KEY_NOT_SCOPED_KEY" };
  if (
    typeof question !== "string" ||
    question.normalize("NFKC").replace(/\s+/g, " ").trim().length < QUESTION_MIN_CHARACTERS ||
    question.length > QUESTION_MAX_CHARACTERS
  ) return { ok: false, code: "QUESTION_LENGTH" };
  const body = JSON.stringify({ question });
  if (new TextEncoder().encode(body).length > ASK_BODY_BYTE_LIMIT) return { ok: false, code: "QUESTION_TOO_LARGE" };
  return { ok: true, collectionId, apiKey, body };
}

/**
 * The single request. Same-origin and credential-free, so a signed-in browser session can never
 * stand in for the key; not cached; a redirect is an error rather than a second request that
 * could carry the bearer somewhere else.
 */
export function askRequest(checked: CheckedRequest, signal: AbortSignal): [string, RequestInit] {
  return [askEndpoint(checked.collectionId), {
    method: "POST",
    headers: { authorization: `Bearer ${checked.apiKey}`, "content-type": "application/json" },
    body: checked.body,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    mode: "same-origin",
    referrerPolicy: "no-referrer",
    signal,
  }];
}

/* ------------------------------------------------------------------ response */

type JsonRecord = Record<string, unknown>;

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Opaque ids carry no grammar here beyond being a present (not blank), bounded, printable string.
 * The value is kept exactly as sent; the trim only decides whether anything is there.
 */
function opaqueId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_OPAQUE_ID_CHARACTERS && !CONTROL_CHARACTER.test(value);
}

function validPage(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

// grounded-ask.ts's validBbox: integer 0-1000 coordinates, x0 < x1 and y0 < y1.
function validBbox(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((coordinate) => Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 1000) &&
    value[0] < value[2] &&
    value[1] < value[3]
  );
}

function validExcerpt(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= EXCERPT_CHARACTER_LIMIT;
}

function parseCitation(value: unknown, path: RetrievalPath): VerifiedCitation | null {
  if (!record(value) || !opaqueId(value.evidenceId) || !opaqueId(value.sourceVersionId) || !validExcerpt(value.excerpt)) return null;
  if (path === "excerpt-concatenation-fallback") {
    // GroundedAnswer citation: always a source, a page and a region.
    if (!opaqueId(value.sourceId) || !validPage(value.pageNumber1) || !validBbox(value.bbox1000)) return null;
    return Object.freeze({
      evidenceId: value.evidenceId,
      sourceId: value.sourceId,
      sourceVersionId: value.sourceVersionId,
      unitId: null,
      pageNumber1: value.pageNumber1,
      bbox1000: Object.freeze([...value.bbox1000] as [number, number, number, number]),
      excerpt: value.excerpt,
    });
  }
  // PacketCitation: the cited id is the first of the unit's evidence ids; page and region may be null.
  const evidenceIds = value.evidenceIds;
  if (!Array.isArray(evidenceIds) || evidenceIds.length < 1 || !evidenceIds.every(opaqueId) || evidenceIds[0] !== value.evidenceId) return null;
  if (!opaqueId(value.unitId)) return null;
  if (value.pageNumber1 !== null && !validPage(value.pageNumber1)) return null;
  if (value.bbox1000 !== null && !validBbox(value.bbox1000)) return null;
  return Object.freeze({
    evidenceId: value.evidenceId,
    sourceId: null,
    sourceVersionId: value.sourceVersionId,
    unitId: value.unitId,
    pageNumber1: value.pageNumber1 === null ? null : Number(value.pageNumber1),
    bbox1000: value.bbox1000 === null ? null : Object.freeze([...(value.bbox1000 as number[])] as [number, number, number, number]),
    excerpt: value.excerpt,
  });
}

export type AskParse =
  | { readonly ok: true; readonly receipt: VerificationReceipt }
  | { readonly ok: false; readonly code: "MALFORMED_SUCCESS" | "COLLECTION_MISMATCH" | "MANIFEST_MISMATCH" };

const MALFORMED = Object.freeze({ ok: false, code: "MALFORMED_SUCCESS" } as const);

/**
 * Read a 200 body as an Ask answer for `requestedCollectionId`, or refuse it. Fails closed: an
 * unknown code, a status that contradicts its code, a grounded answer that is blank or uncited,
 * an abstention that carries prose, a receipt bound to another collection or another manifest,
 * or any malformed citation refuses the whole body -- never a partial render.
 */
export function parseAskSuccess(value: unknown, requestedCollectionId: string): AskParse {
  if (!record(value)) return MALFORMED;
  const code = value.code;
  if (code !== "GROUNDED_ANSWER" && code !== "ANSWER_ABSTAINED") return MALFORMED;
  if (value.answerMode !== "evidence_excerpts") return MALFORMED;
  const path = value.retrievalPath;
  if (path !== "compiled-retrieval-v1" && path !== "excerpt-concatenation-fallback") return MALFORMED;
  const grounded = code === "GROUNDED_ANSWER";
  if (value.status !== (grounded ? "grounded" : "abstained")) return MALFORMED;

  const world = value.activeWorld;
  if (
    !record(world) ||
    typeof world.worldStateId !== "string" || !WORLD_STATE_ID.test(world.worldStateId) ||
    typeof world.manifestDigest !== "string" || !SHA256.test(world.manifestDigest) ||
    !Number.isSafeInteger(world.revision) || Number(world.revision) < 0
  ) return MALFORMED;

  const receipt = value.receipt;
  if (
    !record(receipt) ||
    typeof receipt.collectionId !== "string" || !COLLECTION_ID_PATTERN.test(receipt.collectionId) ||
    typeof receipt.manifestDigest !== "string" || !SHA256.test(receipt.manifestDigest) ||
    typeof receipt.outputSha256 !== "string" || !SHA256.test(receipt.outputSha256) ||
    receipt.candidatePromotion !== false ||
    (path === "excerpt-concatenation-fallback" ? receipt.retrieval !== FALLBACK_RECEIPT_RETRIEVAL : !opaqueId(receipt.retrieval))
  ) return MALFORMED;
  if (receipt.collectionId !== requestedCollectionId) return { ok: false, code: "COLLECTION_MISMATCH" };
  if (receipt.manifestDigest !== world.manifestDigest) return { ok: false, code: "MANIFEST_MISMATCH" };

  if (!Array.isArray(value.citations) || value.citations.length > MAX_RENDERED_CITATIONS) return MALFORMED;
  const citations: VerifiedCitation[] = [];
  for (const item of value.citations) {
    const citation = parseCitation(item, path);
    if (!citation) return MALFORMED;
    citations.push(citation);
  }

  const answer = value.answer;
  if (typeof answer !== "string") return MALFORMED;
  let abstentionReason: AbstentionReason | null = null;
  if (grounded) {
    const limit = path === "compiled-retrieval-v1" ? COMPILED_ANSWER_CHARACTER_LIMIT : FALLBACK_ANSWER_CHARACTER_LIMIT;
    if (answer.trim() === "" || answer.length > limit || citations.length === 0 || value.reason !== null) return MALFORMED;
  } else {
    // Both builders return "" for an abstention and keep citations only on an answer-length overflow.
    if (answer !== "" || typeof value.reason !== "string" || value.reason.length < 1 || value.reason.length > 200) return MALFORMED;
    if (citations.length > 0 && value.reason !== EVIDENCE_EXCEEDS_ANSWER_LIMIT) return MALFORMED;
    abstentionReason = KNOWN_ABSTENTION_REASONS.has(value.reason) ? (value.reason as AbstentionReason) : "OTHER";
  }

  return {
    ok: true,
    receipt: Object.freeze({
      outcome: grounded ? ("evidence" as const) : ("abstained" as const),
      code,
      retrievalPath: path,
      answerMode: "evidence_excerpts" as const,
      answer,
      abstentionReason,
      citations: Object.freeze(citations),
      activeWorld: Object.freeze({
        worldStateId: world.worldStateId,
        manifestDigest: world.manifestDigest,
        revision: Number(world.revision),
      }),
      receipt: Object.freeze({
        collectionId: receipt.collectionId,
        manifestDigest: receipt.manifestDigest,
        outputSha256: receipt.outputSha256,
      }),
    }),
  };
}

function statusClass(status: number): RefusalCode {
  if (status === 401) return "AUTHENTICATION_REFUSED";
  if (status === 402 || status === 403) return "ACCESS_REFUSED";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 400 && status < 500) return "REQUEST_REFUSED";
  if (status >= 500 && status < 600) return "SERVICE_UNAVAILABLE";
  return "UNEXPECTED_STATUS";
}

function refused(code: RefusalCode, serverCode: string | null = null, status: number | null = null): VerificationState {
  const safeStatus = status !== null && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  return Object.freeze({ kind: "refused" as const, refusal: Object.freeze({ code, serverCode, status: safeStatus }) });
}

export type VerificationResponse = { readonly status: number; text(): Promise<string> };

/** Turn one HTTP response into a state. Never echoes a body; a non-200 code is kept only if allowlisted. */
export async function readVerificationResponse(response: VerificationResponse, requestedCollectionId: string): Promise<VerificationState> {
  const status = response.status;
  let text: string;
  try {
    text = await response.text();
  } catch {
    return refused("NETWORK_FAILURE");
  }
  if (typeof text !== "string") return refused("NETWORK_FAILURE");
  if (status === 200) {
    if (text.length > MAX_RESPONSE_CHARACTERS) return refused("RESPONSE_TOO_LARGE", null, status);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return refused("RESPONSE_NOT_JSON", null, status);
    }
    const parsed = parseAskSuccess(json, requestedCollectionId);
    if (!parsed.ok) return refused(parsed.code, null, status);
    return parsed.receipt.outcome === "evidence"
      ? Object.freeze({ kind: "evidence" as const, receipt: parsed.receipt })
      : Object.freeze({ kind: "abstained" as const, receipt: parsed.receipt });
  }
  let serverCode: string | null = null;
  if (text.length <= MAX_ERROR_BODY_CHARACTERS) {
    try {
      const json: unknown = JSON.parse(text);
      if (record(json) && typeof json.code === "string" && SERVER_REFUSAL_COPY.has(json.code)) serverCode = json.code;
    } catch {
      // A non-JSON error body is still a refusal by status; its text is never shown.
    }
  }
  return refused(statusClass(status), serverCode, status);
}

/* ------------------------------------------------------------------ lifecycle */

export type VerificationFetch = (url: string, init: RequestInit) => Promise<VerificationResponse>;

export type VerificationController = {
  /** Send one request, unless one is already in flight. Resolves with the state it published, or null. */
  submit(input: VerificationInput): Promise<VerificationState | null>;
  /** An input changed: abandon any request in flight and clear any previous result. */
  invalidate(): void;
  /** The customer cancelled the request in flight. */
  cancel(): void;
  /** The view is going away: abandon everything and publish nothing more. */
  dispose(): void;
  readonly busy: boolean;
};

type Flight = { readonly abort: AbortController; timer: ReturnType<typeof setTimeout> | undefined; settled: boolean };

const IDLE: VerificationState = Object.freeze({ kind: "idle" as const });
const PENDING: VerificationState = Object.freeze({ kind: "pending" as const });

/**
 * The one place a request is started, abandoned and published. A flight ends exactly once --
 * by its response, its deadline, an input change, a cancel or disposal -- and ending it clears
 * its deadline and aborts its signal. A response that arrives for a flight that has already
 * ended is dropped even if the fetch ignored the abort, so an old answer can never be shown
 * for a new key, collection or question.
 */
export function createVerificationController(options: {
  fetch: VerificationFetch;
  onState: (state: VerificationState) => void;
}): VerificationController {
  let current: Flight | null = null;
  let disposed = false;

  const publish = (state: VerificationState) => {
    if (!disposed) options.onState(state);
  };
  const end = (flight: Flight) => {
    if (flight.settled) return false;
    flight.settled = true;
    if (flight.timer !== undefined) clearTimeout(flight.timer);
    flight.timer = undefined;
    flight.abort.abort();
    if (current === flight) current = null;
    return true;
  };

  return {
    get busy() {
      return current !== null;
    },
    async submit(input) {
      if (disposed || current !== null) return null;
      const checked = checkVerificationRequest(input);
      if (!checked.ok) {
        const state = refused(checked.code);
        publish(state);
        return state;
      }
      const flight: Flight = { abort: new AbortController(), timer: undefined, settled: false };
      current = flight;
      publish(PENDING);
      flight.timer = setTimeout(() => {
        if (end(flight)) publish(refused("DEADLINE_EXCEEDED"));
      }, VERIFICATION_DEADLINE_MS);
      const [url, init] = askRequest(checked, flight.abort.signal);
      let outcome: VerificationState;
      try {
        const response = await options.fetch(url, init);
        if (flight.settled) return null;
        outcome = await readVerificationResponse(response, checked.collectionId);
      } catch {
        outcome = refused("NETWORK_FAILURE");
      }
      if (!end(flight)) return null;
      publish(outcome);
      return outcome;
    },
    invalidate() {
      if (current) end(current);
      publish(IDLE);
    },
    cancel() {
      if (current && end(current)) publish(refused("CANCELLED"));
    },
    dispose() {
      disposed = true;
      if (current) end(current);
    },
  };
}
