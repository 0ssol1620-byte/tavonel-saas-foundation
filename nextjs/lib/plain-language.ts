/*
  The plain-language layer for what the engine says to a first-time customer (UI-D, audit D-02..D-05, D-18).

  The workspace printed engine output as its headline: a review reason as `SEMANTIC_CLAIMS_EMPTY` in a
  mono chip, a developer scope as `collections:compile`, an audit row as `oauth_connection_synced` beside
  a UUID. Each of those is what a support thread needs and not what a customer reads.

  One module owns the mapping, so a new code is one row here and not a new sentence invented at a call
  site. A reason has three parts a customer can act on -- what it means, what TAVONEL did, what they can do
  next -- and the raw code stays available as a technical reference (a collapsed disclosure), never as the
  headline.

  Nothing here invents a meaning. A code with no row says only that a check flagged the result for a person
  and prints the reference; it does not guess what the check was (the same rule as `failureSentence`).
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
  "TAVONEL held this result back. Nothing was activated and nothing was changed, so your AI cannot use it yet.";

const SEE_EVIDENCE = "Look at the pages and evidence below to see what was read.";
const FIX_FILES = "Check that the files hold readable text, replace or add files, then run the compile again.";

type Row = { headline: string; meaning: string; next?: string };

const REASONS: Record<string, Row> = {
  SEMANTIC_CLAIMS_EMPTY: {
    headline: "No statements could be taken from these documents.",
    meaning: "TAVONEL read the pages but found no statement it could tie back to a page, so there is nothing to build knowledge from.",
    next: FIX_FILES,
  },
  EXTRACTION_BUDGET_REACHED: {
    headline: "This compile stopped before it looked at everything.",
    meaning: "There was more to find than one compile checks, so part of the knowledge may be missing from this version.",
    next: SEE_EVIDENCE,
  },
  DETERMINISTIC_MATERIALIZATION_UNPROVEN: {
    headline: "TAVONEL could not confirm this result is repeatable.",
    meaning: "The files that make up this version did not match when they were checked a second time.",
  },
  SOURCE_COVERAGE_INCOMPLETE: {
    headline: "A document is missing from the result.",
    meaning: "At least one document you chose does not appear in what was built.",
  },
  EVIDENCE_COVERAGE_INCOMPLETE: {
    headline: "A document has nothing tied to a page.",
    meaning: "At least one document produced no statement that points back to a page region.",
    next: FIX_FILES,
  },
  IMMUTABLE_INPUTS_ONLY_UNPROVEN: {
    headline: "TAVONEL could not confirm every file was used exactly as uploaded.",
    meaning: "The record that ties the result to your uploaded files did not check out.",
  },
  READING_NEEDS_OPERATOR_REVIEW: {
    headline: "This document stopped at a reading check.",
    meaning: "TAVONEL could not read it with enough certainty, so it was set aside instead of guessed at.",
    next: "Remove it from the list and upload it again, or upload a clearer copy.",
  },
  READING_DID_NOT_FINISH: {
    headline: "Reading this document did not finish.",
    meaning: "The document was not fully read, so it is not part of the result.",
    next: "Upload it again, then compile again.",
  },
  READING_LISTING_DISAGREEMENT: {
    headline: "The list of documents changed while it was being read.",
    meaning: "What was read did not match the list of documents in this compile.",
    next: "Compile again once the uploads have finished.",
  },
  SOURCE_VERSION_AMBIGUOUS: {
    headline: "More than one version of this document was found.",
    meaning: "TAVONEL cannot tell which version you meant, so it did not pick one.",
    next: "Remove the extra copies, then compile again.",
  },
  OCR_LOW_TEXT_YIELD: {
    headline: "Very little text could be read from this document.",
    meaning: "The pages are mostly images, or the scan is too faint to read reliably.",
    next: "Upload a clearer scan or a text version of the file.",
  },
  OCR_SOURCE_EMPTY: {
    headline: "This document is empty.",
    meaning: "There were no pages to read.",
    next: "Upload the right file, then compile again.",
  },
  OCR_PAGES_INCOMPLETE: {
    headline: "Some pages of this document could not be read.",
    meaning: "Only part of the document is in the result.",
    next: "Upload it again, or upload a clearer copy.",
  },
  OCR_TIMEOUT_OR_NETWORK: {
    headline: "Reading this document timed out.",
    meaning: "The reader did not answer in time. This says nothing about the document itself.",
    next: "Upload it again.",
  },
  OCR_RECOGNITION_CONFLICT: {
    headline: "Two readings of a page disagreed.",
    meaning: "TAVONEL read the same page twice and got different text, so it asks a person to decide.",
    next: SEE_EVIDENCE,
  },
  CONTRADICTION_CANDIDATE: {
    headline: "Two statements may disagree with each other.",
    meaning: "Documents say different things about the same topic. TAVONEL does not choose between them for you.",
    next: SEE_EVIDENCE,
  },
  CONTRADICTION_GROUP_TOO_LARGE: {
    headline: "Many statements on one topic may conflict.",
    meaning: "There are more possible conflicts on one topic than a compile checks automatically.",
    next: SEE_EVIDENCE,
  },
  CONTRADICTION_PAIR_BUDGET_EXCEEDED: {
    headline: "Some possible conflicts were left unchecked.",
    meaning: "This compile used its automatic checks on other topics first.",
    next: SEE_EVIDENCE,
  },
};

/** Result checks the package validator raises. Each is a consistency problem in the built result. */
const INTEGRITY: Record<string, string> = {
  MODEL_EMPTY: "The built result is empty.",
  SOURCE_UNBOUND: "A statement is not tied to its document.",
  SOURCE_VERSION_INVALID: "A document version in the result is not valid.",
  SOURCE_DIGEST_INVALID: "A document's fingerprint in the result is not valid.",
  EVIDENCE_DANGLING: "A statement points at a page region that is not in the result.",
  CLAIM_DANGLING: "An item refers to a statement that is not in the result.",
  ENTITY_DANGLING: "An item refers to a name that is not in the result.",
  RELATION_DANGLING: "A link refers to something that is not in the result.",
  COORDINATE_MALFORMED: "A page region has a position that cannot be read.",
  COORDINATE_OUT_OF_RANGE: "A page region lies outside its page.",
  COORDINATE_DEGENERATE: "A page region has no size.",
  PAGE_OUT_OF_RANGE: "A page region points past the last page of its document.",
  GRAPH_DISAGREEMENT: "The exported files disagree with each other.",
  GRAPH_CSV_HEADER_WRONG: "An exported file is laid out wrongly.",
  FILE_NOT_PARSEABLE: "An exported file could not be read back.",
  COUNTS_DISAGREE: "The totals in the result do not add up.",
  ID_DUPLICATE: "Two items in the result share one identifier.",
  ID_NOT_STABLE: "An item's identifier would change between runs.",
  OBJECT_KIND_UNKNOWN: "The result holds an item of a kind TAVONEL does not know.",
  OBJECT_LABEL_MISSING: "An item in the result has no label.",
  PREDICATE_UNDECLARED: "A link in the result uses a relation that was never declared.",
  PACKAGE_FILE_MISSING: "A file that belongs in the package is missing.",
  PACKAGE_ROOT_UNKNOWN: "The package holds a folder it should not.",
  PATH_UNSAFE: "The package holds a file path that is not allowed.",
  SCHEMA_UNSUPPORTED: "The result uses a format version TAVONEL does not read.",
  LIFECYCLE_UNKNOWN: "The result is in a state TAVONEL does not recognise.",
  COLLECTION_ID_NOT_STABLE: "The result's identifier would change between runs.",
  BLUEPRINT_UNSUPPORTED: "The result uses a layout TAVONEL does not support.",
  SIGNATURE_ABSENT: "The package is missing its signature.",
  SIGNATURE_PRESENT: "The package carries a signature it should not have yet.",
};

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
 * An unknown code gets the generic sentence and `known: false`; it is never given a guessed meaning.
 */
export function describeReviewReason(value: string): PlainReason {
  const code = codeOf(value);
  const row = REASONS[code];
  if (row) {
    return { headline: row.headline, meaning: row.meaning, didWhat: HELD_BACK, next: row.next ?? SEE_EVIDENCE, technical: value, known: true };
  }
  const integrity = INTEGRITY[code];
  if (integrity) {
    return {
      headline: "A check on the built result failed.",
      meaning: integrity,
      didWhat: HELD_BACK,
      next: "Compile again. If it stops the same way, send us the reference.",
      technical: value,
      known: true,
    };
  }
  const family = /^SECURITY/i.test(code)
    ? "A safety check stopped this document."
    : /^OCR_|^READING_/.test(code)
      ? "A reading check flagged this document."
      : "A check flagged this result for a person to look at.";
  return {
    headline: family,
    meaning: "TAVONEL has no plain description for this particular check yet, so it does not guess what it found.",
    didWhat: HELD_BACK,
    next: `${SEE_EVIDENCE} If it is not clear, send us the reference.`,
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
