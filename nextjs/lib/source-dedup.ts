import { randomUUID } from "node:crypto";
import { checkConnectorSourceAccessForViewer } from "./connector-source-access";
import { deliverOperationsAlert } from "./operations-p0";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  B1 (PROGRAM-2026-11-04 §4.B): exact-duplicate detection at compile intake.

  Keyed on the CDR's sanitized-output digest -- the bytes OCR read, which the compile has already
  checked against the version key (validateCollectionOcrInput) -- and on the source digest the
  upload confirm recorded, which the database reads itself (migration 20261104090500). Both match
  inside one workspace only; the RPC has no cross-workspace path.

  TAVONEL_SOURCE_DEDUP_MODE, default off:
    off     the RPC is never called and nothing about the compile changes.
    shadow  fingerprints and relations are recorded; the only output is the internal telemetry
            line `duplicate_detected{kind:exact}`, counting what THIS call added (a re-compile of a
            known pair adds nothing) and the OCR reads that call could have reused. The compile
            response is unchanged.
    on      as shadow, plus a "duplicate of X" note on the compile response, naming only documents
            the requesting viewer may read now (checkConnectorSourceAccessForViewer: connector ACL,
            paused and deleted sources excluded). No authenticated viewer, no names.

  In no mode does a duplicate change what is compiled, stored or charged: OCR reuse is B1's next
  rung and needs its own benchmark (§4.B B1 gate). A failed recording is logged as an error and the
  compile proceeds exactly as with the flag off -- this is an annotation, not a gate. A changed
  source digest is an integrity fault and also pages operations.
*/

export type SourceDedupMode = "off" | "shadow" | "on";

/** Public DTO. A kind and the documents, nothing else: an exact match has no score to leak. */
export type ExactDuplicateNote = Readonly<{
  documentId: string;
  kind: "exact";
  duplicateOfDocumentIds: readonly string[];
}>;

type Env = Readonly<Record<string, string | undefined>>;
type Input = Readonly<{ documentId: string; versionKey: string; inputSha256: string; pageCount?: number }>;
type Relation = { documentId: string; relatedDocumentId: string; kind: "exact_bytes"; matchedOn: string[] };
type Answer = { relations: Relation[]; newRelations: number; reusableReadDocumentIds: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUNBOOK = "https://github.com/0ssol1620-byte/tavonel-saas-foundation/blob/main/docs/runbooks/P0_INCIDENT_COST_ALERTS.md";

/** An unrecognised value is off and says so: a flag that silently read as `on` would be worse. */
export function sourceDedupMode(env: Env = process.env): SourceDedupMode {
  const raw = env.TAVONEL_SOURCE_DEDUP_MODE?.trim() ?? "";
  if (raw === "" || raw === "off") return "off";
  if (raw === "shadow" || raw === "on") return raw;
  log("error", { event: "duplicate_detection_misconfigured", kind: "exact", code: "TAVONEL_SOURCE_DEDUP_MODE_INVALID" });
  return "off";
}

function log(level: "info" | "error", line: Record<string, string | number>) {
  try {
    console[level](JSON.stringify(line));
  } catch { /* telemetry never breaks a compile */ }
}

function readAnswer(body: unknown, inputs: readonly Input[]): Answer | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { schemaVersion?: unknown; fingerprints?: unknown; relations?: unknown;
    newRelations?: unknown; reusableReadDocumentIds?: unknown };
  if (value.schemaVersion !== "tavonel.source_fingerprints.v1" || value.fingerprints !== inputs.length
    || !Array.isArray(value.relations) || !Number.isInteger(value.newRelations) || (value.newRelations as number) < 0
    || !Array.isArray(value.reusableReadDocumentIds)) return null;
  const asked = new Set(inputs.map((input) => input.documentId.toLowerCase()));
  const relations: Relation[] = [];
  for (const item of value.relations as unknown[]) {
    const relation = item as Partial<Relation> | null;
    if (!relation || typeof relation.documentId !== "string" || typeof relation.relatedDocumentId !== "string"
      || !asked.has(relation.documentId) || !UUID.test(relation.relatedDocumentId)
      || relation.documentId === relation.relatedDocumentId || relation.kind !== "exact_bytes"
      || !Array.isArray(relation.matchedOn) || relation.matchedOn.length < 1
      || !relation.matchedOn.every((digest) => digest === "sanitized_sha256" || digest === "source_sha256")) return null;
    relations.push(relation as Relation);
  }
  const reusable = value.reusableReadDocumentIds as unknown[];
  if (!reusable.every((id) => typeof id === "string" && asked.has(id))) return null;
  return { relations, newRelations: value.newRelations as number, reusableReadDocumentIds: reusable as string[] };
}

/** A recorded source digest changed under a fingerprint: the stop-the-line class, so it pages. */
async function reportIntegrityFault(mode: SourceDedupMode, workspaceKey: string) {
  log("error", { event: "source_fingerprint_integrity_fault", kind: "exact", mode, code: "SOURCE_FINGERPRINT_CONFLICT" });
  await deliverOperationsAlert({
    alertId: randomUUID(), kind: "incident", severity: "critical", service: "supabase",
    summary: `Source fingerprint conflict in ${workspaceKey}: a recorded source digest changed (B1 exact dedup)`,
    observedAt: new Date().toISOString(), runbookUrl: RUNBOOK,
  }).catch(() => undefined);
}

/**
 * Records this compile's fingerprints and returns what the mode lets the requesting viewer see: the
 * notes under `on`, null under `off` and `shadow` and on any failure.
 */
export async function detectExactDuplicatesAtIntake(
  workspaceKey: string,
  inputs: readonly Input[],
  env: Env = process.env,
  viewerUserId: string | null = null,
): Promise<readonly ExactDuplicateNote[] | null> {
  const mode = sourceDedupMode(env);
  if (mode === "off" || inputs.length === 0) return null;
  const fail = (code: string) => {
    log("error", { event: "duplicate_detection_failed", kind: "exact", mode, code });
    return null;
  };
  const config = readSupabaseAdminConfig(env);
  if (!config) return fail("LIBRARY_DEDUP_STORE_NOT_CONFIGURED");

  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/record_source_fingerprints", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_key: workspaceKey,
        p_fingerprints: inputs.map((input) => ({
          documentId: input.documentId.toLowerCase(),
          sourceVersionId: input.versionKey.toLowerCase(),
          sanitizedSha256: input.inputSha256.toLowerCase(),
        })),
      }),
    });
  } catch {
    return fail("LIBRARY_DEDUP_STORE_UNREACHABLE");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: unknown; code?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message : "";
    if (body?.code === "PGRST202" || body?.code === "42883") return fail("LIBRARY_DEDUP_MIGRATION_ABSENT");
    if (message.includes("source_fingerprint_conflict")) {
      await reportIntegrityFault(mode, workspaceKey);
      return null;
    }
    if (message.includes("source_fingerprint_request_invalid")) return fail("SOURCE_FINGERPRINT_REQUEST_INVALID");
    return fail("LIBRARY_DEDUP_STORE_FAILED");
  }
  const answer = readAnswer(await response.json().catch(() => null), inputs);
  if (!answer) return fail("LIBRARY_DEDUP_RESPONSE_INVALID");

  // Counts only, and only what this call added: no workspace, document or digest leaves through the log.
  if (answer.newRelations > 0) {
    const reusable = new Set(answer.reusableReadDocumentIds);
    const pages = inputs.filter((input) => reusable.has(input.documentId.toLowerCase()))
      .reduce((sum, input) => sum + (Number.isInteger(input.pageCount) ? input.pageCount! : 0), 0);
    log("info", { event: "duplicate_detected", kind: "exact", mode, newRelations: answer.newRelations,
      reusableOcrDocuments: reusable.size, reusableOcrPages: pages });
  }
  if (mode !== "on") return null;
  if (!viewerUserId) return [];

  // ponytail: one access check per related document (the checker answers all-or-nothing); batch when B4 renders notes at volume.
  const related = [...new Set(answer.relations.map((relation) => relation.relatedDocumentId))];
  const readable = new Set((await Promise.all(related.map(async (id) =>
    (await checkConnectorSourceAccessForViewer(workspaceKey, [id], viewerUserId)).ok ? id : null)))
    .filter((id): id is string => id !== null));
  const notes = new Map<string, Set<string>>();
  for (const relation of answer.relations) {
    if (!readable.has(relation.relatedDocumentId)) continue;
    notes.set(relation.documentId, (notes.get(relation.documentId) ?? new Set()).add(relation.relatedDocumentId));
  }
  return [...notes].map(([documentId, ids]) => ({ documentId, kind: "exact" as const, duplicateOfDocumentIds: [...ids].sort() }));
}
