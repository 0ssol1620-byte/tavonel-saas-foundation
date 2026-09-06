import { normalizeDocumentMimeType } from "./qualifiedDocumentInputs";
import type { DocumentMetadata } from "./tenantDomain";
import type { RepresentationKind, SourceFamily } from "./uskcEnums";

/**
 * Universal Source domain (USKC contract v1 §4.1; blueprint §6.1–6.3, §7).
 *
 * A `Source` is the logical origin, a `SourceVersion` is one immutable set of bytes observed for
 * it, and a `SourceRepresentation` is one derived artifact of that version. The point of the
 * three is that nothing overwrites the original with a parse of it: the CDR output and the OCR
 * JSON are representations *of* a version, recorded beside it with the provider and revision that
 * produced them.
 *
 * Everything here is pure. It reads no bytes, calls no provider, and issues no identifier —
 * identifier derivation and persistence live in `nextjs/lib/source-domain-store.ts`, because they
 * depend on the R2 key layout and on `node:crypto`, and this module is imported by both runtimes.
 *
 * Interim identity rules for this campaign, reversible and listed for the founder in
 * `docs/UNIVERSAL_SOURCE_DOMAIN_2026-09-06.md`:
 *   - `sourceId === documents.id` (`legacyDocumentIdToSourceId` is the one place that changes),
 *   - exactly one `SourceVersion` per document row, so `parentVersionId` is always absent,
 *   - `tenantId` carries the value the compile envelope carries today, which is the workspace id.
 */
export const SOURCE_SCHEMA = "tavonel.source.v2" as const;
export const SOURCE_VERSION_SCHEMA = "tavonel.source_version.v2" as const;
export const SOURCE_REPRESENTATION_SCHEMA = "tavonel.source_representation.v1" as const;

const SHA256 = /^sha256:[a-f0-9]{64}$/;
/** Same shape the compile envelope already accepts (`productCoreCompileEnvelope.ts`). */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

/**
 * The shape AND a real instant. The pattern alone accepts `2026-13-45T99:99:99Z`, which is a string
 * shaped like a time and orders against nothing. Parsing alone is not enough either: `2026-02-30`
 * does not fail to parse, it silently becomes 2 March — a ledger row would then carry a date its
 * writer never observed. So the parsed date must spell itself the same way back.
 */
function isInstant(value: string): boolean {
  if (!ISO_INSTANT.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value.slice(0, 10);
}

export type SourceOriginKind = "upload" | "connector" | "api" | "database" | "repository";

export type Source = {
  sourceId: string;
  tenantId: string;
  workspaceId: string;
  originKind: SourceOriginKind;
  originProvider?: string;
  canonicalUri?: string;
  sourceFamily: SourceFamily;
  createdAt: string;
  tombstonedAt?: string;
  tombstoneReason?: string;
};

export type SourceVersion = {
  sourceVersionId: string;
  sourceId: string;
  immutableObjectKey: string;
  /** `sha256:<64 lowercase hex>` — the digest of the bytes at `immutableObjectKey`. */
  contentSha256: string;
  byteLength: number;
  mimeType: string;
  sourceModifiedAt?: string;
  observedAt: string;
  parentVersionId?: string;
  tombstoned: boolean;
  securityClassification?: string;
};

export type SourceRepresentation = {
  representationId: string;
  sourceVersionId: string;
  kind: RepresentationKind;
  providerId: string;
  providerRevision: string;
  contentSha256: string;
  objectKey: string;
  lossy: boolean;
  /** representationIds of the SAME sourceVersionId. */
  derivedFrom: string[];
  createdAt: string;
};

export type SourceLedger = {
  source: Source;
  version: SourceVersion;
  representations: SourceRepresentation[];
};

export type SourceLedgerViolation =
  | "SOURCE_IDENTIFIER_INVALID"
  | "SOURCE_DIGEST_INVALID"
  | "SOURCE_TIMESTAMP_INVALID"
  | "SOURCE_VERSION_NOT_BOUND"
  | "SOURCE_VERSION_DIGEST_CONFLICT"
  | "REPRESENTATION_LINEAGE_BROKEN"
  | "ORIGINAL_IMMUTABLE"
  | "SOURCE_TOMBSTONED";

export type SourceLedgerDecision =
  | { valid: true }
  | { valid: false; code: SourceLedgerViolation; detail: string };

function invalid(code: SourceLedgerViolation, detail: string): SourceLedgerDecision {
  return { valid: false, code, detail };
}

const VALID: SourceLedgerDecision = { valid: true };

/**
 * MIME to source family (blueprint §7).
 *
 * Only the eleven MIME types intake accepts today plus `application/zip` are classified; anything
 * else is `unknown`. Guessing a family from a prefix would put a source into a routing class no
 * reader has been qualified for, which is the "fail closed-open" this lane is warned about.
 */
const SOURCE_FAMILY_BY_MIME: ReadonlyMap<string, SourceFamily> = new Map<string, SourceFamily>([
  ["application/pdf", "document"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
  ["application/vnd.oasis.opendocument.text", "document"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "spreadsheet"],
  ["application/vnd.oasis.opendocument.spreadsheet", "spreadsheet"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "presentation"],
  ["application/vnd.oasis.opendocument.presentation", "presentation"],
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/tiff", "image"],
  ["image/gif", "image"],
  ["application/zip", "archive"],
]);

export function sourceFamilyForMimeType(mimeType: string): SourceFamily {
  // A Map and not an object literal: an object literal answers the MIME type `__proto__` with
  // `Object.prototype` and `constructor` with a function, neither of which is a SourceFamily and
  // neither of which the `?? "unknown"` default can catch. In a Map they are keys like any other.
  return SOURCE_FAMILY_BY_MIME.get(normalizeDocumentMimeType(mimeType)) ?? "unknown";
}

/**
 * Identity mapping for this campaign. Every legacy `documents.id` is its own `sourceId`, so
 * "old document IDs resolve through the adapter" (§48 P0-A) is satisfied without a lookup table.
 * When a logical source outlives a file replacement, this is the one place that changes.
 */
export function legacyDocumentIdToSourceId(documentId: string): string {
  return documentId;
}

/**
 * What a `DocumentMetadata` row cannot tell us, and the caller must have observed.
 *
 * `DocumentMetadata` (`shared/tenantDomain.ts`) carries no byte length, no object size and no
 * timestamps, and its `sourceSha256` is the pre-CDR quarantine digest rather than the digest of
 * the immutable object the compiler reads. A pure adapter cannot invent any of those, so they
 * are supplied by whoever read them. See the contradiction noted in this lane's report.
 */
export type SourceObservation = {
  immutableObjectKey: string;
  contentSha256: string;
  byteLength: number;
  mimeType: string;
  observedAt: string;
  createdAt: string;
  sourceVersionId: string;
};

export function documentToSource(
  document: DocumentMetadata,
  observed: SourceObservation,
): { source: Source; version: SourceVersion } {
  const sourceId = legacyDocumentIdToSourceId(document.id);
  return {
    source: {
      sourceId,
      // No tenant segment exists anywhere in the live object layout or the live envelope; the
      // workspace is the tenancy boundary in code today (contract §7 R-8).
      tenantId: document.workspaceId,
      workspaceId: document.workspaceId,
      originKind: "upload",
      sourceFamily: sourceFamilyForMimeType(document.declaredMimeType),
      createdAt: observed.createdAt,
    },
    version: {
      sourceVersionId: observed.sourceVersionId,
      sourceId,
      immutableObjectKey: observed.immutableObjectKey,
      contentSha256: observed.contentSha256,
      byteLength: observed.byteLength,
      mimeType: observed.mimeType,
      observedAt: observed.observedAt,
      tombstoned: false,
    },
  };
}

function checkSource(source: Source): SourceLedgerDecision {
  if (!IDENTIFIER.test(source.sourceId) || !IDENTIFIER.test(source.workspaceId) || !IDENTIFIER.test(source.tenantId)) {
    return invalid("SOURCE_IDENTIFIER_INVALID", source.sourceId);
  }
  if (!isInstant(source.createdAt)) return invalid("SOURCE_TIMESTAMP_INVALID", source.createdAt);
  if (source.tombstonedAt !== undefined && !isInstant(source.tombstonedAt)) {
    return invalid("SOURCE_TIMESTAMP_INVALID", source.tombstonedAt);
  }
  // A reason without a time is a tombstone nothing can order against a compile.
  if (source.tombstoneReason !== undefined && source.tombstonedAt === undefined) {
    return invalid("SOURCE_TIMESTAMP_INVALID", source.tombstoneReason);
  }
  return VALID;
}

function checkVersion(source: Source, version: SourceVersion): SourceLedgerDecision {
  if (!IDENTIFIER.test(version.sourceVersionId)) return invalid("SOURCE_IDENTIFIER_INVALID", version.sourceVersionId);
  if (version.sourceId !== source.sourceId) return invalid("SOURCE_VERSION_NOT_BOUND", version.sourceVersionId);
  if (!SHA256.test(version.contentSha256)) return invalid("SOURCE_DIGEST_INVALID", version.contentSha256);
  if (!Number.isSafeInteger(version.byteLength) || version.byteLength < 1) {
    return invalid("SOURCE_DIGEST_INVALID", `byteLength:${String(version.byteLength)}`);
  }
  if (!version.immutableObjectKey) return invalid("SOURCE_IDENTIFIER_INVALID", "immutableObjectKey");
  if (!isInstant(version.observedAt)) return invalid("SOURCE_TIMESTAMP_INVALID", version.observedAt);
  if (version.parentVersionId !== undefined && !IDENTIFIER.test(version.parentVersionId)) {
    return invalid("SOURCE_IDENTIFIER_INVALID", version.parentVersionId);
  }
  return VALID;
}

function checkRepresentations(
  version: SourceVersion,
  representations: readonly SourceRepresentation[],
): SourceLedgerDecision {
  const byId = new Map(representations.map((item) => [item.representationId, item]));
  if (byId.size !== representations.length) {
    return invalid("REPRESENTATION_LINEAGE_BROKEN", "duplicate representationId");
  }
  for (const representation of representations) {
    const where = representation.representationId;
    if (!IDENTIFIER.test(where)) return invalid("SOURCE_IDENTIFIER_INVALID", where);
    if (representation.sourceVersionId !== version.sourceVersionId) {
      return invalid("REPRESENTATION_LINEAGE_BROKEN", `${where} is not bound to ${version.sourceVersionId}`);
    }
    if (!SHA256.test(representation.contentSha256)) return invalid("SOURCE_DIGEST_INVALID", where);
    if (!representation.objectKey) return invalid("SOURCE_IDENTIFIER_INVALID", `${where} objectKey`);
    if (!representation.providerId.trim() || !representation.providerRevision.trim()) {
      // An unrecorded provider revision makes the artifact unreproducible; it is not a default.
      return invalid("REPRESENTATION_LINEAGE_BROKEN", `${where} has no provider revision`);
    }
    if (!isInstant(representation.createdAt)) return invalid("SOURCE_TIMESTAMP_INVALID", representation.createdAt);
    if (representation.kind === "original") {
      if (representation.derivedFrom.length > 0 || representation.lossy) {
        return invalid("REPRESENTATION_LINEAGE_BROKEN", `${where} is an original with a derivation`);
      }
      if (representation.contentSha256 !== version.contentSha256) {
        // The original representation IS the version's bytes; a different digest means one of the
        // two is describing something it did not read.
        return invalid("SOURCE_VERSION_DIGEST_CONFLICT", where);
      }
      continue;
    }
    if (representation.derivedFrom.length < 1) {
      return invalid("REPRESENTATION_LINEAGE_BROKEN", `${where} has no parent`);
    }
    for (const parentId of representation.derivedFrom) {
      const parent = byId.get(parentId);
      if (!parent || parent.sourceVersionId !== version.sourceVersionId || parentId === where) {
        return invalid("REPRESENTATION_LINEAGE_BROKEN", `${where} -> ${parentId}`);
      }
    }
  }
  if (representations.filter((item) => item.kind === "original").length > 1) {
    return invalid("ORIGINAL_IMMUTABLE", "more than one original representation");
  }
  // Every derived artifact must reduce to a root — a representation that derives from nothing,
  // which by the rule above is the `original`. "My parent exists" is satisfied by two artifacts
  // naming each other, and that chain never reaches the bytes it claims to descend from. Reduce
  // instead of checking one hop: mark the roots, then repeatedly mark whoever's parents are all
  // marked; anything still unmarked is in a cycle or hangs off one.
  const rooted = new Set(
    representations.filter((item) => item.derivedFrom.length === 0).map((item) => item.representationId),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const item of representations) {
      if (rooted.has(item.representationId)) continue;
      if (item.derivedFrom.every((parentId) => rooted.has(parentId))) {
        rooted.add(item.representationId);
        grew = true;
      }
    }
  }
  const unrooted = representations.find((item) => !rooted.has(item.representationId));
  if (unrooted) {
    return invalid("REPRESENTATION_LINEAGE_BROKEN", `${unrooted.representationId} derives from no root`);
  }
  return VALID;
}

/** Structural validation of one source, its version and that version's representations. */
export function validateSourceLedger(ledger: SourceLedger): SourceLedgerDecision {
  const source = checkSource(ledger.source);
  if (!source.valid) return source;
  const version = checkVersion(ledger.source, ledger.version);
  if (!version.valid) return version;
  return checkRepresentations(ledger.version, ledger.representations);
}

/**
 * A tombstoned source or version stays readable for audit and is never compiled again.
 * Validation does not reject it; this is the separate question a compile asks.
 */
export function assertSourceCompilable(source: Source, version: SourceVersion): SourceLedgerDecision {
  if (source.tombstonedAt !== undefined) return invalid("SOURCE_TOMBSTONED", source.sourceId);
  if (version.tombstoned) return invalid("SOURCE_TOMBSTONED", version.sourceVersionId);
  return VALID;
}

/**
 * A sourceVersionId is bound to exactly one digest, for ever. A second binding is a conflict to
 * report, never a row to overwrite — the stored one was written by a writer this one cannot see.
 */
export function validateSourceVersionRebinding(
  existing: SourceVersion | null,
  incoming: SourceVersion,
): SourceLedgerDecision {
  if (!existing) return VALID;
  if (existing.sourceVersionId !== incoming.sourceVersionId) {
    return invalid("SOURCE_VERSION_NOT_BOUND", incoming.sourceVersionId);
  }
  if (existing.contentSha256 !== incoming.contentSha256 || existing.sourceId !== incoming.sourceId) {
    return invalid("SOURCE_VERSION_DIGEST_CONFLICT", incoming.sourceVersionId);
  }
  if (existing.immutableObjectKey !== incoming.immutableObjectKey) {
    return invalid("SOURCE_VERSION_DIGEST_CONFLICT", incoming.immutableObjectKey);
  }
  return VALID;
}

/** The original representation's object key and digest are never rewritten. */
export function validateRepresentationRewrite(
  existing: SourceRepresentation | null,
  incoming: SourceRepresentation,
): SourceLedgerDecision {
  if (!existing) return VALID;
  if (existing.kind !== incoming.kind) {
    return invalid("REPRESENTATION_LINEAGE_BROKEN", incoming.representationId);
  }
  if (
    existing.kind === "original" &&
    (existing.objectKey !== incoming.objectKey || existing.contentSha256 !== incoming.contentSha256)
  ) {
    return invalid("ORIGINAL_IMMUTABLE", incoming.representationId);
  }
  return VALID;
}
