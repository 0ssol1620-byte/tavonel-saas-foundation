import {
  computeRetrievalProfileDigest,
  type RetrievalProfile,
} from "./retrieval-profile";

export type RetrievalProfileIdentity = Readonly<{
  id: string;
  digest: `sha256:${string}`;
}>;

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

/**
 * Return the logical name and content address of an exact retrieval recipe.
 *
 * Callers must not identify an index with the mutable profile name alone. Recomputing the
 * digest here also prevents a deserialised or hand-built profile from claiming another
 * recipe's content address.
 */
export function contentAddressedRetrievalProfileIdentity(
  profile: RetrievalProfile,
): RetrievalProfileIdentity {
  const digest = computeRetrievalProfileDigest(profile);
  if (!SHA256_DIGEST.test(profile.profileDigest) || digest !== profile.profileDigest) {
    throw new Error("RETRIEVAL_PROFILE_DIGEST_MISMATCH");
  }
  return { id: profile.id, digest: digest as `sha256:${string}` };
}

export function sameRetrievalProfileIdentity(
  left: RetrievalProfileIdentity,
  right: RetrievalProfileIdentity,
): boolean {
  return left.id === right.id && left.digest === right.digest;
}
