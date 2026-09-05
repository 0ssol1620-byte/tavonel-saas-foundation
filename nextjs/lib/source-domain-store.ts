import { createHash } from "node:crypto";
import {
  assertSourceCompilable,
  legacyDocumentIdToSourceId,
  sourceFamilyForMimeType,
  validateSourceLedger,
  validateSourceVersionRebinding,
  type Source,
  type SourceLedger,
  type SourceLedgerViolation,
  type SourceRepresentation,
  type SourceVersion,
} from "../../shared/sourceDomain";
import type { RepresentationKind } from "../../shared/uskcEnums";
import { isKeyInsideWorkspacePrefix, isOcrJsonKey, isSanitizedPdfKey } from "./immutable-keys";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  The application's view of the Universal Source ledger (migration 0049).

  Two halves, deliberately separate. `projectSourceLedger` is pure: it turns what a caller has
  actually observed -- object keys, digests, byte lengths, provider revisions -- into the three
  frozen records, deriving every identifier deterministically so that a redelivery of the same
  observation produces the same rows. `recordSourceLedger` writes them, and writes nothing it
  cannot first prove is consistent with what is already stored.

  There is no caller on the live compile path yet, and that is a seam, not an oversight:
  `runCollectionCompile` reads R2 and writes R2, and the only durable database write in that flow
  is the compile job row, written by a security-definer RPC that knows nothing about sources.
  Recording from inside that flow means changing the live compile wire, which contract §7 R-2
  defers. `docs/UNIVERSAL_SOURCE_DOMAIN_2026-09-06.md` names the write point this attaches to.
*/

export type SourceDomainFailure =
  | "SOURCE_DOMAIN_STORE_NOT_CONFIGURED"
  | "SOURCE_DOMAIN_STORE_READ_FAILED"
  | "SOURCE_DOMAIN_STORE_WRITE_FAILED";

export type SourceLedgerProjectionFailure =
  | SourceLedgerViolation
  | "SOURCE_OBSERVATION_INVALID"
  | "REPRESENTATION_OBJECT_KEY_OUT_OF_SCOPE";

export type SourceDomainResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: SourceDomainFailure | SourceLedgerProjectionFailure; detail?: string };

/** One immutable set of bytes, as the caller observed it. Nothing here is derived or assumed. */
export type SourceVersionObservation = {
  workspaceId: string;
  documentId: string;
  declaredMimeType: string;
  immutableObjectKey: string;
  contentSha256: string;
  byteLength: number;
  mimeType: string;
  createdAt: string;
  observedAt: string;
};

/**
 * One derived artifact of that version.
 *
 * `derivedFromKind` names the parent inside the same observation, because the caller knows the
 * chain by role ("the OCR JSON came from the CDR output") and not by an identifier this module
 * has not issued yet.
 */
export type RepresentationObservation = {
  kind: RepresentationKind;
  objectKey: string;
  contentSha256: string;
  providerId: string;
  providerRevision: string;
  lossy: boolean;
  derivedFromKind: RepresentationKind | null;
  createdAt: string;
};

/** Parents are inserted before children, so a lineage row never points at a row that is not there yet. */
const REPRESENTATION_ORDER: readonly RepresentationKind[] = [
  "original",
  "normalized",
  "native",
  "rendered",
  "ocr",
  "visual",
  "canonical_ir",
];

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * `<sourceId>:<digest hex>` — the same pairing `groupImmutableDocuments` already uses to identify
 * a document's bytes, spelled with a separator the compile envelope's identifier pattern accepts.
 */
export function sourceVersionIdFor(sourceId: string, contentSha256: string): string {
  return `${sourceId}:${contentSha256.replace(/^sha256:/, "")}`;
}

export function representationIdFor(sourceVersionId: string, kind: RepresentationKind, objectKey: string): string {
  return `rep-${sha256Hex(`${sourceVersionId}\n${kind}\n${objectKey}`).slice(0, 32)}`;
}

/**
 * Which representation an existing immutable key holds.
 *
 * The key layout is the classifier: `immutable-keys.ts` already parses this set out of the
 * suffixes, and this only names what it finds. An unrecognised key is `null`, never a guess.
 */
export function representationKindForImmutableKey(workspaceId: string, key: string): RepresentationKind | null {
  if (isSanitizedPdfKey(workspaceId, key)) return "normalized";
  if (isOcrJsonKey(workspaceId, key)) return "ocr";
  return null;
}

function isWorkspaceScopedObjectKey(workspaceId: string, documentId: string, key: string): boolean {
  return (
    isKeyInsideWorkspacePrefix(workspaceId, key) ||
    key === `quarantine/${workspaceId}/${documentId}/source`
  );
}

/**
 * Turn one observation into the ledger rows, or refuse.
 *
 * Refusing is the point. A representation whose parent is not in the same observation, an object
 * key outside the workspace, a second artifact claiming the same role -- each of those is a chain
 * that cannot be audited later, and half a chain recorded as if it were whole is worse than none.
 */
export function projectSourceLedger(
  version: SourceVersionObservation,
  representations: readonly RepresentationObservation[],
): { ok: true; ledger: SourceLedger } | { ok: false; code: SourceLedgerProjectionFailure; detail: string } {
  const sourceId = legacyDocumentIdToSourceId(version.documentId);
  const sourceVersionId = sourceVersionIdFor(sourceId, version.contentSha256);
  const source: Source = {
    sourceId,
    tenantId: version.workspaceId,
    workspaceId: version.workspaceId,
    originKind: "upload",
    sourceFamily: sourceFamilyForMimeType(version.declaredMimeType),
    createdAt: version.createdAt,
  };
  const sourceVersion: SourceVersion = {
    sourceVersionId,
    sourceId,
    immutableObjectKey: version.immutableObjectKey,
    contentSha256: version.contentSha256,
    byteLength: version.byteLength,
    mimeType: version.mimeType,
    observedAt: version.observedAt,
    tombstoned: false,
  };
  if (!isWorkspaceScopedObjectKey(version.workspaceId, version.documentId, version.immutableObjectKey)) {
    return { ok: false, code: "REPRESENTATION_OBJECT_KEY_OUT_OF_SCOPE", detail: version.immutableObjectKey };
  }

  const idByKind = new Map<RepresentationKind, string>();
  for (const observation of representations) {
    if (idByKind.has(observation.kind)) {
      return { ok: false, code: "REPRESENTATION_LINEAGE_BROKEN", detail: `two ${observation.kind} representations` };
    }
    if (!isWorkspaceScopedObjectKey(version.workspaceId, version.documentId, observation.objectKey)) {
      return { ok: false, code: "REPRESENTATION_OBJECT_KEY_OUT_OF_SCOPE", detail: observation.objectKey };
    }
    idByKind.set(observation.kind, representationIdFor(sourceVersionId, observation.kind, observation.objectKey));
  }

  const projected: SourceRepresentation[] = [];
  for (const observation of [...representations].sort(
    (left, right) => REPRESENTATION_ORDER.indexOf(left.kind) - REPRESENTATION_ORDER.indexOf(right.kind),
  )) {
    const parentId = observation.derivedFromKind === null ? null : idByKind.get(observation.derivedFromKind) ?? null;
    if (observation.derivedFromKind !== null && parentId === null) {
      return {
        ok: false,
        code: "REPRESENTATION_LINEAGE_BROKEN",
        detail: `${observation.kind} -> ${observation.derivedFromKind} is not in this observation`,
      };
    }
    projected.push({
      representationId: idByKind.get(observation.kind)!,
      sourceVersionId,
      kind: observation.kind,
      providerId: observation.providerId,
      providerRevision: observation.providerRevision,
      contentSha256: observation.contentSha256,
      objectKey: observation.objectKey,
      lossy: observation.lossy,
      derivedFrom: parentId === null ? [] : [parentId],
      createdAt: observation.createdAt,
    });
  }

  const ledger: SourceLedger = { source, version: sourceVersion, representations: projected };
  const decision = validateSourceLedger(ledger);
  if (!decision.valid) return { ok: false, code: decision.code, detail: decision.detail };
  return { ok: true, ledger };
}

type SourceVersionRow = {
  source_version_id: string;
  source_id: string;
  immutable_object_key: string;
  content_sha256: string;
  byte_length: number;
  mime_type: string;
  observed_at: string;
  parent_version_id: string | null;
  tombstoned: boolean;
  security_classification: string | null;
};

function versionFromRow(row: SourceVersionRow): SourceVersion {
  return {
    sourceVersionId: row.source_version_id,
    sourceId: row.source_id,
    immutableObjectKey: row.immutable_object_key,
    contentSha256: row.content_sha256,
    byteLength: Number(row.byte_length),
    mimeType: row.mime_type,
    observedAt: row.observed_at,
    tombstoned: row.tombstoned,
    ...(row.parent_version_id === null ? {} : { parentVersionId: row.parent_version_id }),
    ...(row.security_classification === null ? {} : { securityClassification: row.security_classification }),
  };
}

async function admin(path: string, init?: RequestInit): Promise<Response | null> {
  const config = readSupabaseAdminConfig();
  if (!config) return null;
  try {
    return await supabaseAdminRequest(config, path, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }
}

/*
  `resolution=ignore-duplicates` and never `merge-duplicates`.

  Delivery is at-least-once, so the same observation arrives twice and the second write must be a
  no-op. Merging would make it an overwrite instead -- and an overwrite here is a stored digest
  being replaced by whatever the later caller believed, which is the one thing this ledger exists
  to make impossible. A genuine disagreement is caught before the write, by reading first.
*/
async function insertIgnoringDuplicates(table: string, rows: unknown[]): Promise<boolean> {
  const response = await admin(`/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  return Boolean(response?.ok);
}

export async function readSourceVersion(sourceVersionId: string): Promise<SourceDomainResult<SourceVersion | null>> {
  if (!readSupabaseAdminConfig()) return { ok: false, code: "SOURCE_DOMAIN_STORE_NOT_CONFIGURED" };
  const response = await admin(
    `/rest/v1/source_versions?source_version_id=eq.${encodeURIComponent(sourceVersionId)}&limit=1`,
  );
  if (!response?.ok) return { ok: false, code: "SOURCE_DOMAIN_STORE_READ_FAILED" };
  const rows = (await response.json().catch(() => null)) as SourceVersionRow[] | null;
  if (!Array.isArray(rows)) return { ok: false, code: "SOURCE_DOMAIN_STORE_READ_FAILED" };
  return { ok: true, value: rows[0] ? versionFromRow(rows[0]) : null };
}

/**
 * Record one source, its version and that version's representations.
 *
 * Read first, then write: a stored version bound to a different digest is reported as a conflict
 * and nothing is written. Representations go in parent-before-child order so a lineage row never
 * references a row that does not exist yet.
 */
export async function recordSourceLedger(ledger: SourceLedger): Promise<SourceDomainResult<"recorded">> {
  const structural = validateSourceLedger(ledger);
  if (!structural.valid) return { ok: false, code: structural.code, detail: structural.detail };
  const compilable = assertSourceCompilable(ledger.source, ledger.version);
  if (!compilable.valid) return { ok: false, code: compilable.code, detail: compilable.detail };

  const existing = await readSourceVersion(ledger.version.sourceVersionId);
  if (!existing.ok) return existing;
  const rebinding = validateSourceVersionRebinding(existing.value, ledger.version);
  if (!rebinding.valid) return { ok: false, code: rebinding.code, detail: rebinding.detail };

  const source = ledger.source;
  const wroteSource = await insertIgnoringDuplicates("sources", [
    {
      source_id: source.sourceId,
      tenant_id: source.tenantId,
      workspace_id: source.workspaceId,
      origin_kind: source.originKind,
      origin_provider: source.originProvider ?? null,
      canonical_uri: source.canonicalUri ?? null,
      source_family: source.sourceFamily,
      created_at: source.createdAt,
      tombstoned_at: source.tombstonedAt ?? null,
      tombstone_reason: source.tombstoneReason ?? null,
    },
  ]);
  if (!wroteSource) return { ok: false, code: "SOURCE_DOMAIN_STORE_WRITE_FAILED", detail: "sources" };

  const version = ledger.version;
  const wroteVersion = await insertIgnoringDuplicates("source_versions", [
    {
      source_version_id: version.sourceVersionId,
      source_id: version.sourceId,
      immutable_object_key: version.immutableObjectKey,
      content_sha256: version.contentSha256,
      byte_length: version.byteLength,
      mime_type: version.mimeType,
      source_modified_at: version.sourceModifiedAt ?? null,
      observed_at: version.observedAt,
      parent_version_id: version.parentVersionId ?? null,
      tombstoned: version.tombstoned,
      security_classification: version.securityClassification ?? null,
    },
  ]);
  if (!wroteVersion) return { ok: false, code: "SOURCE_DOMAIN_STORE_WRITE_FAILED", detail: "source_versions" };

  for (const representation of ledger.representations) {
    const wrote = await insertIgnoringDuplicates("source_representations", [
      {
        representation_id: representation.representationId,
        source_version_id: representation.sourceVersionId,
        kind: representation.kind,
        provider_id: representation.providerId,
        provider_revision: representation.providerRevision,
        content_sha256: representation.contentSha256,
        object_key: representation.objectKey,
        lossy: representation.lossy,
        derived_from: representation.derivedFrom,
        created_at: representation.createdAt,
      },
    ]);
    if (!wrote) {
      return { ok: false, code: "SOURCE_DOMAIN_STORE_WRITE_FAILED", detail: representation.representationId };
    }
  }
  return { ok: true, value: "recorded" };
}
