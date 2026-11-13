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

  /*
    One candidate in memory at a time, plus the first readable one as the fallback. This read
    every listed version (up to 12) in parallel and parsed them all, so peak memory was twelve
    parsed Worlds: harmless at 24 MiB packages, an out-of-memory at the 56 MiB the package bound
    now allows. The preference is unchanged -- the first completed candidate in listing order,
    else the first readable one, else the first failure.
  */
  // ponytail: sequential GETs, so a collection with many versions waits for each; bounded
  // parallelism (2-3) if the open latency of long histories shows up.
  let fallback: StoredCollection | null = null;
  let firstFailure: { ok: false; code: string } | null = null;
  for (const key of keys) {
    const result = await getWorkspaceCollectionCandidate(signer, workspaceId, key);
    if (!result.ok) {
      firstFailure ??= result;
      continue;
    }
    const artifact = result.json as {
      coreExecution?: { status?: unknown; receipt?: { candidatePromotion?: unknown } };
    };
    if (artifact.coreExecution?.status === "completed" && artifact.coreExecution.receipt?.candidatePromotion === false) {
      return { ok: true, value: { key, artifact: result.json } };
    }
    fallback ??= { key, artifact: result.json };
  }
  if (fallback) return { ok: true, value: fallback };
  return firstFailure ?? { ok: false, code: "GET_FAILED" };
}
