import { collectionCandidateKey, isCollectionCandidateKey } from "./immutable-keys";
import { getWorkspaceCollectionCandidate, listImmutableWorkspaceObjects } from "./r2-objects";
import type { R2SignerEnv } from "./r2-synthetic-canary";

type StoredCollection = {
  key: string;
  artifact: unknown;
};

export async function loadPreferredCollectionCandidate(
  signer: R2SignerEnv,
  workspaceId: string,
  collectionId: string,
  manifestDigest?: string,
): Promise<{ ok: true; value: StoredCollection } | { ok: false; code: string }> {
  if (manifestDigest) {
    if (!/^sha256:[a-f0-9]{64}$/.test(manifestDigest)) {
      return { ok: false, code: "MANIFEST_DIGEST_INVALID" };
    }
    const key = collectionCandidateKey(
      workspaceId,
      collectionId,
      manifestDigest.slice("sha256:".length),
    );
    if (!key) return { ok: false, code: "COLLECTION_KEY_INVALID" };
    const exact = await getWorkspaceCollectionCandidate(signer, workspaceId, key);
    return exact.ok
      ? { ok: true, value: { key, artifact: exact.json } }
      : exact;
  }
  const listed = await listImmutableWorkspaceObjects(signer, workspaceId);
  if (!listed.ok) return listed;

  const keys = listed.objects
    .map((item) => item.key)
    .filter((key) => isCollectionCandidateKey(workspaceId, key) && key.includes(`/collections/${collectionId}/`))
    .slice(0, 12);
  if (keys.length === 0) return { ok: false, code: "NOT_FOUND" };

  const fetched = await Promise.all(
    keys.map(async (key) => ({ key, result: await getWorkspaceCollectionCandidate(signer, workspaceId, key) })),
  );
  const available = fetched.filter(
    (item): item is { key: string; result: { ok: true; json: unknown } } => item.result.ok,
  );
  const preferred = available.find((item) => {
    const artifact = item.result.json as {
      coreExecution?: { status?: unknown; receipt?: { candidatePromotion?: unknown } };
    };
    return artifact.coreExecution?.status === "completed" && artifact.coreExecution.receipt?.candidatePromotion === false;
  }) ?? available[0];

  if (preferred) return { ok: true, value: { key: preferred.key, artifact: preferred.result.json } };
  const firstFailure = fetched.find((item) => !item.result.ok);
  return firstFailure && !firstFailure.result.ok
    ? firstFailure.result
    : { ok: false, code: "GET_FAILED" };
}
