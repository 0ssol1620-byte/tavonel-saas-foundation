import {
  FOUNDATION_R2_BUCKET,
  readR2SignerEnv,
  type R2SignerEnv,
} from "./r2-synthetic-canary";
import {
  hashFoundationSourceInventoryObject,
  listFoundationSourceInventory,
  MAX_WORLD_OBJECTS,
  sourceInventoryListingsEqual,
  type SourceInventoryObject,
} from "./source-deletion-inventory-r2";
import {
  discardSourceDeletionInventoryDigests,
  readSourceDeletionInventoryCandidate,
  readSourceDeletionInventoryDigests,
  recordSourceDeletionInventoryDigest,
  recordSourceDeletionInventoryFailure,
  sealSourceDeletionInventory,
  type SourceDeletionInventoryCandidate,
} from "./source-deletion-inventory-store";

export type SourceDeletionInventoryRun =
  | { ok: true; code: "IDLE"; processed: 0 }
  | {
      ok: true;
      code: "ATTESTED";
      processed: 1;
      artifactCount: number;
      status: "recorded" | "replayed";
    }
  | {
      ok: true;
      code: "IN_PROGRESS";
      processed: 0;
      deletionId: string;
      hashedCount: number;
      remainingCount: number;
    }
  | { ok: false; code: string; processed: 0; deletionId?: string; failureRecorded?: boolean };

// What one run hashes before it stops starting new objects; the digests it persisted carry over.
// One object may still take its own 30 s read timeout after the cut, inside the route's 60 s.
export const HASH_BUDGET_BYTES = 1024 * 1024 * 1024;
export const HASH_BUDGET_MS = 15_000;

type Dependencies = {
  recordFailure?: typeof recordSourceDeletionInventoryFailure;
  signer?: R2SignerEnv | null;
  list?: typeof listFoundationSourceInventory;
  hash?: typeof hashFoundationSourceInventoryObject;
  readCandidate?: typeof readSourceDeletionInventoryCandidate;
  readDigests?: typeof readSourceDeletionInventoryDigests;
  recordDigest?: typeof recordSourceDeletionInventoryDigest;
  discardDigests?: typeof discardSourceDeletionInventoryDigests;
  seal?: typeof sealSourceDeletionInventory;
  now?: () => number;
};

type Steps = Required<Pick<Dependencies,
  "list" | "hash" | "readDigests" | "recordDigest" | "discardDigests" | "seal" | "now">>;

export async function runSourceDeletionInventoryAttestation(
  dependencies: Dependencies = {},
): Promise<SourceDeletionInventoryRun> {
  const signer = dependencies.signer === undefined ? readR2SignerEnv() : dependencies.signer;
  if (!signer || signer.bucket !== FOUNDATION_R2_BUCKET) {
    return { ok: false, code: "SOURCE_INVENTORY_R2_NOT_CONFIGURED", processed: 0 };
  }
  const readCandidate = dependencies.readCandidate ?? readSourceDeletionInventoryCandidate;
  const recordFailure = dependencies.recordFailure ?? recordSourceDeletionInventoryFailure;
  const steps: Steps = {
    list: dependencies.list ?? listFoundationSourceInventory,
    hash: dependencies.hash ?? hashFoundationSourceInventoryObject,
    readDigests: dependencies.readDigests ?? readSourceDeletionInventoryDigests,
    recordDigest: dependencies.recordDigest ?? recordSourceDeletionInventoryDigest,
    discardDigests: dependencies.discardDigests ?? discardSourceDeletionInventoryDigests,
    seal: dependencies.seal ?? sealSourceDeletionInventory,
    now: dependencies.now ?? Date.now,
  };

  const candidateResult = await readCandidate();
  if (!candidateResult.ok) return { ok: false, code: candidateResult.code, processed: 0 };
  const candidate = candidateResult.candidate;
  if (!candidate) return { ok: true, code: "IDLE", processed: 0 };

  const result = await attestCandidate(candidate, signer, steps);
  if (result.ok) return result;
  // Every failure after a candidate was chosen is recorded against that tombstone, which moves it
  // behind every other candidate: one deletion that cannot be attested no longer stalls the rest,
  // and it is retried on the next rotation rather than skipped. Progress is not a failure: the
  // same tombstone stays first and the next run continues it.
  const recorded = await recordFailure(candidate.deletionId, result.code);
  return { ...result, deletionId: candidate.deletionId, failureRecorded: recorded.ok };
}

/** The persisted digests cover exactly this listing: the same keys at the same listed sizes. */
function digestsMatchListing(
  digests: readonly SourceInventoryObject[],
  listing: readonly SourceInventoryObject[],
) {
  const sizes = new Map(listing.map((object) => [object.key, object.sizeBytes]));
  return digests.length === listing.length
    && digests.every((object) => sizes.get(object.key) === object.sizeBytes);
}

/**
 * Hashes a bounded batch of the objects no earlier run hashed, persisting each digest as soon as it
 * exists, and seals once every listed object has one. A run that dies between objects loses at
 * most the object it was reading.
 */
async function attestCandidate(
  candidate: SourceDeletionInventoryCandidate,
  signer: R2SignerEnv,
  steps: Steps,
): Promise<SourceDeletionInventoryRun> {
  const failed = (code: string) => ({ ok: false as const, code, processed: 0 as const });
  // An oversized World set is refused, never narrowed: there is no wildcard over a collection.
  if (candidate.worldObjectKeys.length > MAX_WORLD_OBJECTS) return failed("SOURCE_INVENTORY_WORLD_LIMIT");
  const list = () => steps.list(signer, candidate.workspaceKey, candidate.documentIds, candidate.worldObjectKeys);

  const before = await list();
  if (!before.ok) return failed(before.code);
  // The database refuses this too, and refusing it here as well is not redundancy: a worker
  // that submits an empty listing has already decided the prefix is empty, and the round trip
  // that would tell it otherwise is the one being guarded. An R2 listing that returns nothing
  // for a source that still has bound documents is a listing that failed open.
  if (before.objects.length === 0 && candidate.documentIds.length > 0) {
    return failed("SOURCE_INVENTORY_EMPTY_LISTING");
  }

  let stored = await steps.readDigests(candidate.deletionId);
  if (!stored.ok) return failed(stored.code);
  // A digest whose key is no longer listed, or is listed at another size, was taken from bytes
  // that are not the ones there now. None of the set is trusted then: discard it and hash again.
  const listedSizes = new Map(before.objects.map((object) => [object.key, object.sizeBytes]));
  let hashedKeys = new Set(stored.digests.objects.map((object) => object.key));
  if (stored.digests.objects.some((object) => listedSizes.get(object.key) !== object.sizeBytes)) {
    const discarded = await steps.discardDigests(candidate.deletionId);
    if (!discarded.ok) return failed(discarded.code);
    hashedKeys = new Set();
  }

  const missing = before.objects.filter((object) => !hashedKeys.has(object.key));
  const started = steps.now();
  let hashedBytes = 0;
  let hashedCount = 0;
  for (const object of missing) {
    // Always at least one object per run, so a run makes progress even when one object fills it.
    if (hashedCount > 0 && (hashedBytes + object.sizeBytes > HASH_BUDGET_BYTES
      || steps.now() - started >= HASH_BUDGET_MS)) break;
    const hashed = await steps.hash(signer, candidate.workspaceKey, object);
    if (!hashed.ok) return failed(hashed.code);
    const recorded = await steps.recordDigest(candidate.deletionId, hashed.object);
    if (!recorded.ok) return failed(recorded.code);
    hashedBytes += object.sizeBytes;
    hashedCount += 1;
  }
  if (hashedCount < missing.length) {
    return {
      ok: true,
      code: "IN_PROGRESS",
      processed: 0,
      deletionId: candidate.deletionId,
      hashedCount,
      remainingCount: missing.length - hashedCount,
    };
  }

  // A CDR/OCR writer racing the scan changes either the key set or a listed byte length.
  // Refuse instead of sealing a prefix that was only complete at the start of the request.
  const after = await list();
  if (!after.ok) return failed(after.code);
  if (!sourceInventoryListingsEqual(before.objects, after.objects)) {
    return failed("SOURCE_INVENTORY_CHANGED_DURING_SCAN");
  }

  // Read again: this run's digests are in it now, and its digestSetSha256 is what the seal checks.
  // A set that no longer matches the listing was changed by an overlapping run; nothing is sealed.
  stored = await steps.readDigests(candidate.deletionId);
  if (!stored.ok) return failed(stored.code);
  if (!digestsMatchListing(stored.digests.objects, before.objects)) {
    return failed("SOURCE_INVENTORY_DIGESTS_CHANGED");
  }

  // The full World key set goes along: a key missing from the digests was listed absent and is
  // recorded as absent -- only a purge receipt ever says an object was removed.
  const sealed = await steps.seal(candidate.deletionId, stored.digests.digestSetSha256, candidate.worldObjectKeys);
  if (!sealed.ok) return failed(sealed.code);
  if (sealed.attestation.artifactCount !== before.objects.length) {
    return failed("SOURCE_INVENTORY_ATTESTATION_COUNT_MISMATCH");
  }
  return {
    ok: true,
    code: "ATTESTED",
    processed: 1,
    artifactCount: before.objects.length,
    status: sealed.attestation.status,
  };
}
