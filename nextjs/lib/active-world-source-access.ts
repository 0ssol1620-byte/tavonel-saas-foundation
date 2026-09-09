import { validatePromotableCollectionArtifact } from "./collection-download";
import { collectionSourceDocumentIds } from "./collection-source-access";
import { getWorkspaceCollectionCandidate } from "./r2-objects";
import { readR2SignerEnv } from "./r2-synthetic-canary";
import type { ActiveWorld } from "./world-store";

export async function loadActiveWorldSourceIds(workspaceKey: string, collectionId: string, world: ActiveWorld): Promise<
  { ok: true; documentIds: string[] } | { ok: false; code: string }
> {
  const signer = readR2SignerEnv();
  if (!signer) return { ok: false, code: "SIGNER_NOT_CONFIGURED" };
  const loaded = await getWorkspaceCollectionCandidate(signer, workspaceKey, world.candidateObjectKey);
  if (!loaded.ok) return { ok: false, code: loaded.code };
  const artifact = validatePromotableCollectionArtifact(loaded.json, collectionId);
  if (!artifact || artifact.manifestDigest !== world.manifestDigest) return { ok: false, code: "ACTIVE_WORLD_ARTIFACT_INVALID" };
  const documentIds = collectionSourceDocumentIds(artifact);
  return documentIds ? { ok: true, documentIds } : { ok: false, code: "COLLECTION_SOURCE_BINDING_INVALID" };
}
