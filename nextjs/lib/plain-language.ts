/*
  The plain-language layer for what the engine says to a first-time customer (UI-D, audit D-02..D-05, D-18).

  The workspace printed engine output as its headline: a review reason as `SEMANTIC_CLAIMS_EMPTY` in a
  mono chip, a developer scope as `collections:compile`, an audit row as `oauth_connection_synced` beside
  a UUID. Each of those is what a support thread needs and not what a customer reads.

  One module owns the mapping, so a new code is one row here and not a new sentence invented at a call
  site. A reason has three parts a customer can act on -- what it means, what TAVONEL did, what they can do
  next -- and the raw code stays available as a technical reference (a collapsed disclosure), never as the
  headline.

  Nothing here invents a meaning. A code with no sourced row says only that one of the checks did not pass and
  prints the reference; it does not guess what the check was. See the policy comment below `SEE_EVIDENCE`.
*/

export type PlainReason = {
  /** One short sentence that can stand alone as a heading. */
  headline: string;
  /** What it means, for someone who has never seen the engine. */
  meaning: string;
  /** What TAVONEL did about it. Never claims more than the held-back result. */
  didWhat: string;
  /** What the customer can do now. */
  next: string;
  /** The recorded code, for support. Shown only inside a collapsed "Technical details". */
  technical: string;
  /** False when the code has no row of its own and the generic sentence stands in. */
  known: boolean;
};

/** What happened to the result, the same for every review reason: the held-back state is the product's rule. */
export const HELD_BACK =
  "TAVONEL held this result back. Nothing was activated and nothing was changed. A version that was held back cannot be activated from the workspace.";

const SEE_EVIDENCE = "Look at the pages and evidence below to see what was read.";
const SEND_REFERENCE = "Send us the reference if you want us to look at it.";

/*
  The policy (UI-D review round 3). A sentence here states ONLY (a) what the product visibly does or (b) what
  a source in THIS repository says the check is. Anything else is the neutral sentence, with the exact code
  left under Technical details. Twice a sentence explained a mechanism the code did not perform ("a second
  check", "past the last page"), so the rule is structural rather than a matter of care:

    - every non-neutral sentence is listed in `SENTENCE_SOURCES` with the file:line that states it;
    - a test asserts that each cited file contains the cited code;
    - a code with no source in this repo has no row, and gets the neutral sentence.

  When in doubt, delete the row. A code the Python core alone emits (SEMANTIC_CLAIMS_EMPTY) or that only
  appears in a list of names (OCR_LOW_TEXT_YIELD) has no row for that reason.
*/
export const NEUTRAL_HEADLINE = "One of the checks on this result did not pass.";
export const NEUTRAL_MEANING = "The exact check is shown under Technical details.";

type Row = { headline: string; meaning: string; next?: string; source: string[] };

const WORKER = "nextjs/lib/compile-job-worker.ts";
const COMPILER = "nextjs/lib/collection-compiler.ts";
const OCR = "quarantine-sidecar/foundation-cdr-worker/src/ocr.ts";
const SHARED = "shared/compiledWorldValidation.ts";
const VALIDATOR = "nextjs/scripts/compiled-world/validate.mjs";

const REASONS: Record<string, Row> = {
  EXTRACTION_BUDGET_REACHED: {
    headline: "This compile kept only part of what it found.",
    meaning: "TAVONEL found more than one compile keeps, so it kept part of it and left the rest out of this version.",
    next: SEE_EVIDENCE,
    source: [`${COMPILER}:871`, `${COMPILER}:662`],
  },
  DETERMINISTIC_MATERIALIZATION_UNPROVEN: {
    headline: "The files in this version failed the package's own file checks.",
    meaning: "The package validator reported a problem with the exported files themselves, such as files that disagree, a file that is not valid JSON, or totals that disagree.",
    source: [`${SHARED}:73`, `${COMPILER}:860`],
  },
  SOURCE_COVERAGE_INCOMPLETE: {
    headline: "This version failed its check that every document is accounted for.",
    meaning: "The check that each document you chose appears in the built result did not pass.",
    source: [`${SHARED}:74`, `${COMPILER}:861`],
  },
  EVIDENCE_COVERAGE_INCOMPLETE: {
    headline: "This version failed its check that every document is tied to a page.",
    meaning: "The check that each document has at least one statement tied to a valid page region did not pass.",
    source: [`${SHARED}:75`, `${COMPILER}:864`],
  },
  IMMUTABLE_INPUTS_ONLY_UNPROVEN: {
    headline: "This version failed its check on the recorded inputs.",
    meaning: "The check that each input's recorded key and digest match the version that was read did not pass.",
    source: [`${SHARED}:76`, `${COMPILER}:866`],
  },
  READING_NEEDS_OPERATOR_REVIEW: {
    headline: "This document stopped at a reading check.",
    meaning: "The reader produced a review package instead of a result, so this document is not part of the compile.",
    next: "Remove it from the list and upload it again.",
    source: [`${WORKER}:194`, "nextjs/lib/workspace-failure-copy.ts:212"],
  },
  READING_DID_NOT_FINISH: {
    headline: "Reading this document did not finish.",
    meaning: "It had not finished being read when the compile stopped waiting for it, so it is not part of this compile.",
    source: [`${WORKER}:197`, "nextjs/components/compile-job-panel.tsx:66"],
  },
  READING_LISTING_DISAGREEMENT: {
    headline: "TAVONEL's two lists of your documents disagreed, and the compile stopped.",
    meaning: "Two internal views of which documents had been read did not agree on repeated tries.",
    next: "This is not caused by one document you can drop. Send us the reference.",
    source: [`${WORKER}:92`, `${WORKER}:456`],
  },
  SOURCE_VERSION_AMBIGUOUS: {
    headline: "Two versions of this document carry the same identity.",
    meaning: "Nothing chose between them.",
    source: ["nextjs/lib/api-error-codes.ts:408"],
  },
  OCR_SOURCE_EMPTY: {
    headline: "This document is empty.",
    meaning: "The stored PDF for this document is empty.",
    source: [`${OCR}:609`],
  },
  OCR_PAGES_INCOMPLETE: {
    headline: "Reading this document did not finish.",
    meaning: "Not every range of pages had a stored answer, so nothing was assembled for this document.",
    source: [`${OCR}:60`],
  },
  OCR_TIMEOUT_OR_NETWORK: {
    headline: "Reading this document hit a timeout or a network problem.",
    meaning: "This is recorded as a transport fault, not as a finding about the document's content.",
    source: [`${OCR}:55`],
  },
  OCR_RECOGNITION_CONFLICT: {
    headline: "Two readings of a page region disagreed.",
    meaning: "Two reading engines returned different text for the same page region. It is recorded as a conflict and is not decided for you.",
    next: SEE_EVIDENCE,
    source: ["nextjs/lib/collection-download.ts:292", "nextjs/lib/collection-download.ts:321"],
  },
  CONTRADICTION_CANDIDATE: {
    headline: "Two statements may disagree with each other.",
    meaning: "Two statements about the same topic and time were flagged as possibly disagreeing on a number or on whether something holds. TAVONEL does not decide between them.",
    next: SEE_EVIDENCE,
    source: ["nextjs/lib/core-runtime-v2.ts:576"],
  },
  CONTRADICTION_GROUP_TOO_LARGE: {
    headline: "Many statements on one topic may conflict.",
    meaning: "Comparing them takes more checks than a compile makes automatically.",
    next: SEE_EVIDENCE,
    source: ["nextjs/lib/workspace-failure-copy.ts:262"],
  },
  CONTRADICTION_PAIR_BUDGET_EXCEEDED: {
    headline: "Some possible conflicts were left unchecked.",
    meaning: "This compile had already used its automatic checks on other topics.",
    next: SEE_EVIDENCE,
    source: ["nextjs/lib/workspace-failure-copy.ts:264"],
  },
};

/** Result checks the package validator raises: each sentence restates what the cited validator line tests. */
const INTEGRITY: Record<string, { meaning: string; line: number }> = {
  MODEL_EMPTY: { meaning: "The built result describes no objects.", line: 319 },
  SOURCE_UNBOUND: { meaning: "A statement cites a document that is not in the result's list of inputs.", line: 353 },
  SOURCE_VERSION_INVALID: { meaning: "A document's version key in the result is not in the expected form.", line: 326 },
  SOURCE_DIGEST_INVALID: { meaning: "A document's input digest in the result is not in the expected form.", line: 329 },
  EVIDENCE_DANGLING: { meaning: "An item points at evidence that is not in the result.", line: 359 },
  CLAIM_DANGLING: { meaning: "An item refers to a statement that is not in the result.", line: 399 },
  ENTITY_DANGLING: { meaning: "An item refers to an entity that is not in the result.", line: 402 },
  RELATION_DANGLING: { meaning: "A link refers to something that is not in the result.", line: 367 },
  COORDINATE_MALFORMED: { meaning: "A page region's position is not four whole numbers.", line: 380 },
  COORDINATE_OUT_OF_RANGE: { meaning: "A page region leaves the 0 to 1000 page frame.", line: 384 },
  COORDINATE_DEGENERATE: { meaning: "A page region encloses no area.", line: 386 },
  PAGE_OUT_OF_RANGE: { meaning: "A page region has a page number that is not valid.", line: 390 },
  GRAPH_DISAGREEMENT: { meaning: "The exported graph files do not match the model.", line: 416 },
  GRAPH_CSV_HEADER_WRONG: { meaning: "An exported graph file has an unexpected header.", line: 490 },
  FILE_NOT_PARSEABLE: { meaning: "An exported file is not valid JSON.", line: 233 },
  COUNTS_DISAGREE: { meaning: "The counts in the validation report differ from what the package holds.", line: 457 },
  ID_DUPLICATE: { meaning: "Two items in the result share one identifier.", line: 336 },
  ID_NOT_STABLE: { meaning: "An item has an identifier that is not in the expected form.", line: 346 },
  OBJECT_KIND_UNKNOWN: { meaning: "The result holds an item of a kind that is not recognised.", line: 340 },
  OBJECT_LABEL_MISSING: { meaning: "An item in the result has no label.", line: 350 },
  PREDICATE_UNDECLARED: { meaning: "A link in the result uses a relation type that was never declared.", line: 370 },
  PACKAGE_FILE_MISSING: { meaning: "A file that belongs in the package is missing.", line: 296 },
  PACKAGE_ROOT_UNKNOWN: { meaning: "The package holds a top-level folder that is not a package root.", line: 292 },
  PATH_UNSAFE: { meaning: "The package holds a file path that is not allowed.", line: 290 },
  SCHEMA_UNSUPPORTED: { meaning: "The result uses a schema version this validator does not accept.", line: 306 },
  LIFECYCLE_UNKNOWN: { meaning: "The result is in a lifecycle state this validator does not recognise.", line: 474 },
  COLLECTION_ID_NOT_STABLE: { meaning: "The result's collection identifier is not in the expected form.", line: 313 },
  BLUEPRINT_UNSUPPORTED: { meaning: "The result uses a blueprint this validator does not support.", line: 310 },
  SIGNATURE_ABSENT: { meaning: "The package is missing its signature files.", line: 469 },
};

/** Code -> the file:line entries that state the sentence. The test holds each cited file to containing the code. */
export const SENTENCE_SOURCES: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(Object.entries(REASONS).map(([code, row]) => [code, row.source])),
  ...Object.fromEntries(Object.entries(INTEGRITY).map(([code, row]) => [code, [`${VALIDATOR}:${row.line}`]])),
};

/** Codes deliberately left without a row: no source in this repo states what they mean, so they get the neutral sentence. */
export const NEUTRAL_BY_POLICY: readonly string[] = ["SEMANTIC_CLAIMS_EMPTY", "OCR_LOW_TEXT_YIELD"];

/** Every code this module has a sentence for, so a test can hold the review screen's codes to it. */
export const PLAIN_REASON_CODES: readonly string[] = [...Object.keys(REASONS), ...Object.keys(INTEGRITY)];

/** `CODE:detail` and `CODE doc-id` strings carry the code first. The detail (an id, a count) is never printed as text. */
function codeOf(value: string): string {
  return (value.trim().split(/[:\s]/)[0] ?? value).trim();
}

/** A recorded engine code (`UPPER_SNAKE`, optionally followed by detail), as against a sentence someone already wrote. */
export function isReasonCode(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{3,}(?:[:\s]|$)/.test(value.trim());
}

/**
 * The plain account of one recorded review reason.
 *
 * A code with no sourced row gets the neutral sentence and `known: false`; it is never given a guessed meaning.
 */
export function describeReviewReason(value: string): PlainReason {
  const code = codeOf(value);
  const row = REASONS[code];
  if (row) {
    return { headline: row.headline, meaning: row.meaning, didWhat: HELD_BACK, next: row.next ?? SEND_REFERENCE, technical: value, known: true };
  }
  const integrity = INTEGRITY[code];
  if (integrity) {
    return {
      headline: "A check on the built result failed.",
      meaning: integrity.meaning,
      didWhat: HELD_BACK,
      next: SEND_REFERENCE,
      technical: value,
      known: true,
    };
  }
  return {
    headline: NEUTRAL_HEADLINE,
    meaning: NEUTRAL_MEANING,
    didWhat: HELD_BACK,
    next: SEND_REFERENCE,
    technical: value,
    known: false,
  };
}

/* Developer scopes (audit D-05). */
const SCOPES: Record<string, string> = {
  "documents:read": "Read your documents",
  "documents:intake": "Add documents",
  "collections:read": "Read compiled results",
  "collections:compile": "Start compiles",
  "collections:download": "Download packages",
  "worlds:read": "Read active knowledge",
  "ask:read": "Ask questions of active knowledge",
  "connections:read": "See connections",
  "connections:write": "Change connections",
  "connections:sync": "Sync connections",
};

export function plainScope(scope: string): string {
  return SCOPES[scope] ?? "An access this screen has no description for";
}

/* Audit and activity events (audit D-03). Unknown events are humanised, not interpreted. */
const EVENTS: Record<string, string> = {
  api_key_created: "API key created",
  api_key_revoked: "API key revoked",
  api_key_rotated: "API key replaced",
  connection_created: "Connection added",
  connection_updated: "Connection changed",
  connection_revoked: "Connection removed",
  connection_batch_applied: "Files imported from a connection",
  oauth_authorization_started: "Sign-in to a connection started",
  oauth_connection_created: "Connection signed in",
  oauth_connection_revoked: "Connection sign-in withdrawn",
  oauth_connection_synced: "Connection synced",
  oauth_connection_reauthorization_required: "Connection needs signing in again",
  reauthorization_required: "Connection needs signing in again",
};

export function plainEvent(action: string): string {
  const known = EVENTS[action];
  if (known) return known;
  const words = action.replace(/[_:.-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Event";
}

/* Opaque identifiers (audit D-03): ids are references, never labels. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXED_HASH = /^(?:ev|evidence|collection|ws|doc|cjob|corpus|sha256)[-_:]?[0-9a-f]{12,}$/i;
const BARE_HASH = /^[0-9a-f]{16,}$/i;

export function isOpaqueId(value: string): boolean {
  const v = value.trim();
  return UUID.test(v) || PREFIXED_HASH.test(v) || BARE_HASH.test(v);
}

/** The short tail of an id, for a tooltip or a "send us this reference" line. Never a label. */
export function shortReference(value: string): string {
  const flat = value.replace(/^(?:sha256:)/i, "").replace(/[^0-9a-zA-Z]/g, "");
  return flat.length > 8 ? flat.slice(-8).toUpperCase() : flat.toUpperCase();
}

/** What to call a record whose only name is an id. `title` carries the reference for a tooltip. */
export function labelForReference(value: string): { label: string; title: string | undefined } {
  const v = value.trim();
  if (!isOpaqueId(v)) return { label: v, title: undefined };
  const kind = /^ev/i.test(v) ? "Evidence record"
    : /^collection/i.test(v) ? "Compiled result"
      : /^ws/i.test(v) ? "Workspace version"
        : /^(?:cjob|corpus)/i.test(v) ? "Compile run"
          : /^doc/i.test(v) ? "Document"
            : "Record";
  return { label: kind, title: `Reference ${shortReference(v)}` };
}

/** The tab title for a workspace surface: the page name leads, so history and tabs tell the pages apart. */
export function workspaceDocumentTitle(surfaceTitle: string, documentCount: number): string {
  const count = surfaceTitle === "Home" ? ` · ${documentCount} document${documentCount === 1 ? "" : "s"}` : "";
  return `${surfaceTitle}${count} — TAVONEL`;
}
