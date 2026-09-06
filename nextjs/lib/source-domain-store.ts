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
  | "SOURCE_DOMAIN_STORE_WRITE_FAILED"
  /** A row is already stored under this key and it does not say what this caller is presenting. */
  | "SOURCE_DOMAIN_STORE_CONFLICT";

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
  for (const observation of representations) {
    if (observation.derivedFromKind !== null && !idByKind.has(observation.derivedFromKind)) {
      return {
        ok: false,
        code: "REPRESENTATION_LINEAGE_BROKEN",
        detail: `${observation.kind} -> ${observation.derivedFromKind} is not in this observation`,
      };
    }
  }

  /*
    Parents before children, whatever order the caller listed them in and whatever the kinds are.
    A lineage row that names a row not yet inserted is refused by the database, and the chain -- not
    the vocabulary -- is what says which artifact came first, so this is a topological pass and not
    a fixed list of kinds. A set of observations that never runs out of unemitted parents derives
    from itself, and a provenance rooted in itself is refused here rather than written.
  */
  const projected: SourceRepresentation[] = [];
  const emitted = new Set<RepresentationKind>();
  const pending = [...representations];
  while (pending.length > 0) {
    const next = pending.findIndex(
      (item) => item.derivedFromKind === null || emitted.has(item.derivedFromKind),
    );
    if (next === -1) {
      return {
        ok: false,
        code: "REPRESENTATION_LINEAGE_BROKEN",
        detail: `${pending.map((item) => item.kind).join(", ")} derive from each other`,
      };
    }
    const observation = pending.splice(next, 1)[0]!;
    const parentId = observation.derivedFromKind === null ? null : idByKind.get(observation.derivedFromKind) ?? null;
    emitted.add(observation.kind);
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

/** PostgREST returns a timestamptz normalised ("+00:00"), so compare instants and not spellings. */
function storedValueAgrees(column: string, sent: unknown, stored: unknown): boolean {
  if (sent === null) return stored === null;
  if (column.endsWith("_at") && typeof sent === "string" && typeof stored === "string") {
    return Date.parse(sent) === Date.parse(stored);
  }
  if (typeof sent === "number") return Number(stored) === sent;
  return JSON.stringify(stored) === JSON.stringify(sent);
}

/*
  Insert one row, then prove that what is stored is what this caller presented.

  `resolution=ignore-duplicates` and never `merge-duplicates`: delivery is at-least-once, so the
  same observation arrives twice and the second write must be a no-op. Merging would make it an
  overwrite instead -- a stored digest replaced by whatever the later caller believed, which is the
  one thing this ledger exists to make impossible.

  But an ignored duplicate answers 201 exactly like a fresh insert, so a caller presenting a
  DIFFERENT digest under a key that is already taken would be told "recorded" while the stored row
  said something else. Nothing else catches that: both immutability triggers in migration 0049 fire
  on UPDATE, and this path only ever inserts. So when nothing came back, the kept row is read and
  compared column by column, and a disagreement is a conflict to report rather than a success.
*/
async function insertVerified(
  table: string,
  keyColumn: string,
  row: Record<string, unknown>,
): Promise<SourceDomainResult<"written">> {
  const key = String(row[keyColumn]);
  const where = `${table}:${key}`;
  const response = await admin(`/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify([row]),
  });
  if (!response?.ok) return { ok: false, code: "SOURCE_DOMAIN_STORE_WRITE_FAILED", detail: where };
  const inserted = (await response.json().catch(() => null)) as unknown;
  if (Array.isArray(inserted) && inserted.length > 0) return { ok: true, value: "written" };

  const stored = await admin(`/rest/v1/${table}?${keyColumn}=eq.${encodeURIComponent(key)}&limit=1`);
  if (!stored?.ok) return { ok: false, code: "SOURCE_DOMAIN_STORE_READ_FAILED", detail: where };
  const rows = (await stored.json().catch(() => null)) as Array<Record<string, unknown>> | null;
  const kept = Array.isArray(rows) ? rows[0] : undefined;
  // Nothing inserted and nothing stored: the write did not happen and no row explains why.
  if (!kept) return { ok: false, code: "SOURCE_DOMAIN_STORE_WRITE_FAILED", detail: where };
  for (const [column, value] of Object.entries(row)) {
    if (!storedValueAgrees(column, value, kept[column])) {
      return { ok: false, code: "SOURCE_DOMAIN_STORE_CONFLICT", detail: `${table}.${column}:${key}` };
    }
  }
  return { ok: true, value: "written" };
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
 * before anything is written. Every row is then written through `insertVerified`, so a key that
 * turns out to be taken by a row saying something else -- a source re-claimed for another tenant, a
 * derived artifact re-presented at a second digest -- is `SOURCE_DOMAIN_STORE_CONFLICT` and not a
 * silent success. A conflict on a representation can leave the source and version rows durable:
 * they were compared against what is stored and agreed with it, so nothing wrong was written; the
 * chain is simply incomplete, which is what a refused write is supposed to leave behind.
 *
 * Representations go in parent-before-child order so a lineage row never references a row that
 * does not exist yet.
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
  const wroteSource = await insertVerified("sources", "source_id", {
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
  });
  if (!wroteSource.ok) return wroteSource;

  const version = ledger.version;
  const wroteVersion = await insertVerified("source_versions", "source_version_id", {
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
  });
  if (!wroteVersion.ok) return wroteVersion;

  for (const representation of ledger.representations) {
    const wrote = await insertVerified("source_representations", "representation_id", {
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
    });
    if (!wrote.ok) return wrote;
  }
  return { ok: true, value: "recorded" };
}
