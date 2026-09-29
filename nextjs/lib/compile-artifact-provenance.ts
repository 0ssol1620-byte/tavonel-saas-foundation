import { COLLECTION_ID_PATTERN } from "./immutable-keys";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  Every candidate-world.json names its documents before it exists (migration 20260930013000).

  Source deletion finds the Worlds a document was compiled into from this registry, so a candidate
  that reaches R2 without a registration would keep a deleted document's content forever. The
  registration is therefore taken first, and it is also a bounded write lease: the database lets
  a deletion inventory proceed only once every registration naming its documents is past
  `publish_by`, so the PUT must start with room to finish well inside that window -- and not at all
  once the room is gone.
*/

/** Lowercase canonical UUID: the only document id a deletion tombstone can name. */
export const CANONICAL_DOCUMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The key shape foundation_world_versions and the registry both enforce. */
const WORKSPACE_KEY = /^pilot-[A-Za-z0-9]{1,16}$/;

/** The R2 PUT aborts at 8 s (r2-objects); a publication starts only with this much lease left. */
export const PUBLISH_MARGIN_MS = 30_000;

const KNOWN_REFUSALS = new Set([
  "COLLECTION_ARTIFACT_SOURCE_DELETED",
  "COLLECTION_ARTIFACT_SOURCE_BLOCKED",
  "COLLECTION_ARTIFACT_PROVENANCE_CONFLICT",
  "COLLECTION_ARTIFACT_PROVENANCE_INVALID",
]);

export type ArtifactRegistration =
  | { ok: true; publishBy: number }
  | { ok: false; code: string; refused: boolean };

export async function registerCollectionArtifact(
  input: { workspaceKey: string; collectionId: string; manifestDigest: string; documentIds: readonly string[] },
  now: () => number = Date.now,
): Promise<ArtifactRegistration> {
  if (!WORKSPACE_KEY.test(input.workspaceKey) || !COLLECTION_ID_PATTERN.test(input.collectionId)
    || !/^sha256:[a-f0-9]{64}$/.test(input.manifestDigest)
    || input.documentIds.length === 0 || !input.documentIds.every((id) => CANONICAL_DOCUMENT_ID.test(id))) {
    return { ok: false, code: "COLLECTION_ARTIFACT_PROVENANCE_INVALID", refused: true };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "COLLECTION_ARTIFACT_PROVENANCE_NOT_CONFIGURED", refused: false };
  // Read before the request: the lease is counted from no later than the database's own clock.
  const startedAt = now();
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/register_collection_artifact_provenance", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_key: input.workspaceKey,
        p_collection_id: input.collectionId,
        p_manifest_digest: input.manifestDigest,
        p_document_ids: [...input.documentIds],
      }),
    });
    const body = await response.json().catch(() => null) as { message?: unknown; leaseSeconds?: unknown } | null;
    if (!response.ok) {
      const message = typeof body?.message === "string" ? body.message : "";
      return KNOWN_REFUSALS.has(message)
        ? { ok: false, code: message, refused: true }
        : { ok: false, code: "COLLECTION_ARTIFACT_PROVENANCE_FAILED", refused: false };
    }
    const leaseSeconds = Number(body?.leaseSeconds);
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds <= 0) {
      return { ok: false, code: "COLLECTION_ARTIFACT_PROVENANCE_FAILED", refused: false };
    }
    return { ok: true, publishBy: startedAt + leaseSeconds * 1000 - PUBLISH_MARGIN_MS };
  } catch {
    return { ok: false, code: "COLLECTION_ARTIFACT_PROVENANCE_FAILED", refused: false };
  }
}

/** Pre-publication check, immediately before the PUT: past this, the object must not be written. */
export function mayPublish(registration: { publishBy: number }, now: () => number = Date.now) {
  return now() < registration.publishBy;
}
