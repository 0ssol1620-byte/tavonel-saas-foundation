import { validatePromotableCollectionArtifact } from "./collection-download";
import { collectionSourceDocumentIds } from "./collection-source-access";
import { checkConnectorSourceAccess } from "./connector-source-access";
import { collectionCandidateKey } from "./immutable-keys";
import { getWorkspaceCollectionCandidate } from "./r2-objects";
import { readR2SignerEnv } from "./r2-synthetic-canary";
import { buildWorldReadModel } from "./world-read-model";

/** Restoring history never restores a source's former permission. */
export async function checkRollbackSourceAccess(
  workspaceKey: string,
  collectionId: string,
  manifestDigest: string,
): Promise<{ ok: true } | { ok: false; code: string; status: number }> {
  const key = collectionCandidateKey(workspaceKey, collectionId, manifestDigest.slice(7));
  if (!key) return { ok: false, code: "WORLD_ROLLBACK_INVALID", status: 400 };
  const signer = readR2SignerEnv();
  if (!signer) return { ok: false, code: "SIGNER_NOT_CONFIGURED", status: 503 };
  const loaded = await getWorkspaceCollectionCandidate(signer, workspaceKey, key);
  if (!loaded.ok) return {
    ok: false, code: loaded.code, status: loaded.code === "NOT_FOUND" ? 404 : 503,
  };
  const artifact = validatePromotableCollectionArtifact(loaded.json, collectionId);
  if (!artifact || artifact.manifestDigest !== manifestDigest ||
      artifact.coreExecution.runtime !== "tavonel-python-core-v2") {
    return { ok: false, code: "ROLLBACK_TARGET_ARTIFACT_INVALID", status: 422 };
  }
  const model = buildWorldReadModel(loaded.json, collectionId);
  if (!model || model.evidence.length === 0) {
    return { ok: false, code: "WORLD_CANDIDATE_EVIDENCE_REQUIRED", status: 422 };
  }
  const documentIds = collectionSourceDocumentIds(artifact);
  if (!documentIds) return { ok: false, code: "COLLECTION_SOURCE_BINDING_INVALID", status: 422 };
  // Use immutable product upload IDs, including all carriers of identical bytes, rather
  // than Core source IDs. The current suspension/deletion policy resolves those IDs.
  const access = await checkConnectorSourceAccess(workspaceKey, documentIds);
  return access.ok ? { ok: true } : {
    ok: false, code: access.code,
    status: access.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503,
  };
}
