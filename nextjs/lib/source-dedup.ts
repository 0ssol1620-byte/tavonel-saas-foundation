import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  B1 (PROGRAM-2026-11-04 §4.B): exact-duplicate detection at compile intake.

  Keyed on the CDR's sanitized-output digest -- the bytes OCR read, which the compile has already
  checked against the version key (validateCollectionOcrInput) -- and on the source digest the
  upload confirm recorded, which the database reads itself (migration 20261104090500). Both match
  inside one workspace only; the RPC has no cross-workspace path.

  TAVONEL_LIBRARY_DEDUP, default off:
    off     the RPC is never called and nothing about the compile changes.
    shadow  fingerprints and relations are recorded; the only output is the internal telemetry
            line `duplicate_detected{kind:exact}`. The compile response is unchanged.
    on      as shadow, plus a "duplicate of X" note on the compile response. Compiles only run for
            workspaces the processing cohort admits, so `on` is cohort-scoped by construction.

  In no mode does a duplicate change what is compiled, stored or charged: OCR reuse is B1's next
  rung and needs its own benchmark (§4.B B1 gate). A failed recording is reported on the log and
  the compile proceeds exactly as with the flag off -- this is an annotation, not a gate.
*/

export type SourceDedupMode = "off" | "shadow" | "on";

/** Public DTO. A kind and the documents, nothing else: an exact match has no score to leak. */
export type ExactDuplicateNote = Readonly<{
  documentId: string;
  kind: "exact";
  duplicateOfDocumentIds: readonly string[];
}>;

type Env = Readonly<Record<string, string | undefined>>;
type Input = Readonly<{ documentId: string; versionKey: string; inputSha256: string }>;
type Relation = { documentId: string; relatedDocumentId: string; kind: "exact_bytes"; matchedOn: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An unrecognised value is off and says so: a flag that silently read as `on` would be worse. */
export function sourceDedupMode(env: Env = process.env): SourceDedupMode {
  const raw = env.TAVONEL_LIBRARY_DEDUP?.trim() ?? "";
  if (raw === "" || raw === "off") return "off";
  if (raw === "shadow" || raw === "on") return raw;
  log({ event: "duplicate_detection_misconfigured", kind: "exact", code: "TAVONEL_LIBRARY_DEDUP_INVALID" });
  return "off";
}

function log(line: Record<string, string | number>) {
  try {
    console.info(JSON.stringify(line));
  } catch { /* telemetry never breaks a compile */ }
}

function readRelations(body: unknown, inputs: readonly Input[]): Relation[] | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { schemaVersion?: unknown; fingerprints?: unknown; relations?: unknown };
  if (value.schemaVersion !== "tavonel.source_fingerprints.v1" || value.fingerprints !== inputs.length
    || !Array.isArray(value.relations)) return null;
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
  return relations;
}

/**
 * Records this compile's fingerprints and returns what the mode lets the workspace see: the notes
 * under `on`, null under `off` and `shadow` and on any failure.
 */
export async function detectExactDuplicatesAtIntake(
  workspaceKey: string,
  inputs: readonly Input[],
  env: Env = process.env,
): Promise<readonly ExactDuplicateNote[] | null> {
  const mode = sourceDedupMode(env);
  if (mode === "off" || inputs.length === 0) return null;
  const fail = (code: string) => {
    log({ event: "duplicate_detection_failed", kind: "exact", mode, code });
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
    if (message.includes("source_fingerprint_conflict")) return fail("SOURCE_FINGERPRINT_CONFLICT");
    if (message.includes("source_fingerprint_request_invalid")) return fail("SOURCE_FINGERPRINT_REQUEST_INVALID");
    return fail("LIBRARY_DEDUP_STORE_FAILED");
  }
  const relations = readRelations(await response.json().catch(() => null), inputs);
  if (!relations) return fail("LIBRARY_DEDUP_RESPONSE_INVALID");

  const notes = new Map<string, string[]>();
  for (const relation of relations) {
    notes.set(relation.documentId, [...(notes.get(relation.documentId) ?? []), relation.relatedDocumentId]);
  }
  // Counts only: no workspace, document or digest leaves through the log.
  if (notes.size > 0) {
    log({ event: "duplicate_detected", kind: "exact", mode, documents: notes.size, relations: relations.length });
  }
  if (mode !== "on") return null;
  return [...notes].map(([documentId, related]) => ({
    documentId, kind: "exact" as const, duplicateOfDocumentIds: [...new Set(related)].sort(),
  }));
}
