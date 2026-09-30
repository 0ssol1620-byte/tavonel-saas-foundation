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
  type SourceInventoryHashedObject,
} from "./source-deletion-inventory-r2";
import {
  readSourceDeletionInventoryCandidate,
  recordSourceDeletionInventoryAttestation,
  recordSourceDeletionInventoryFailure,
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
  | { ok: false; code: string; processed: 0; deletionId?: string; failureRecorded?: boolean };

type Dependencies = {
  recordFailure?: typeof recordSourceDeletionInventoryFailure;
  signer?: R2SignerEnv | null;
  list?: typeof listFoundationSourceInventory;
  hash?: typeof hashFoundationSourceInventoryObject;
  readCandidate?: typeof readSourceDeletionInventoryCandidate;
  attest?: typeof recordSourceDeletionInventoryAttestation;
};

export async function runSourceDeletionInventoryAttestation(
  dependencies: Dependencies = {},
): Promise<SourceDeletionInventoryRun> {
  const signer = dependencies.signer === undefined ? readR2SignerEnv() : dependencies.signer;
  if (!signer || signer.bucket !== FOUNDATION_R2_BUCKET) {
    return { ok: false, code: "SOURCE_INVENTORY_R2_NOT_CONFIGURED", processed: 0 };
  }
  const readCandidate = dependencies.readCandidate ?? readSourceDeletionInventoryCandidate;
  const listed = dependencies.list ?? listFoundationSourceInventory;
  const hash = dependencies.hash ?? hashFoundationSourceInventoryObject;
  const attest = dependencies.attest ?? recordSourceDeletionInventoryAttestation;

  const recordFailure = dependencies.recordFailure ?? recordSourceDeletionInventoryFailure;

  const candidateResult = await readCandidate();
  if (!candidateResult.ok) return { ok: false, code: candidateResult.code, processed: 0 };
  const candidate = candidateResult.candidate;
  if (!candidate) return { ok: true, code: "IDLE", processed: 0 };

  const result = await attestCandidate(candidate, signer, listed, hash, attest);
  if (result.ok) return result;
  // Every failure after a candidate was chosen is recorded against that tombstone, which moves it
  // behind every other candidate: one deletion that cannot be attested no longer stalls the rest,
  // and it is retried on the next rotation rather than skipped.
  const recorded = await recordFailure(candidate.deletionId, result.code);
  return { ...result, deletionId: candidate.deletionId, failureRecorded: recorded.ok };
}

async function attestCandidate(
  candidate: SourceDeletionInventoryCandidate,
  signer: R2SignerEnv,
  listed: typeof listFoundationSourceInventory,
  hash: typeof hashFoundationSourceInventoryObject,
  attest: typeof recordSourceDeletionInventoryAttestation,
): Promise<SourceDeletionInventoryRun> {
  // An oversized World set is refused, never narrowed: there is no wildcard over a collection.
  if (candidate.worldObjectKeys.length > MAX_WORLD_OBJECTS) {
    return { ok: false, code: "SOURCE_INVENTORY_WORLD_LIMIT", processed: 0 };
  }
  const before = await listed(signer, candidate.workspaceKey, candidate.documentIds, candidate.worldObjectKeys);
  if (!before.ok) return { ok: false, code: before.code, processed: 0 };

  const objects: SourceInventoryHashedObject[] = [];
  for (const object of before.objects) {
    const hashed = await hash(signer, candidate.workspaceKey, object);
    if (!hashed.ok) return { ok: false, code: hashed.code, processed: 0 };
    objects.push(hashed.object);
  }

  // A CDR/OCR writer racing the scan changes either the key set or a listed byte length.
  // Refuse instead of sealing a prefix that was only complete at the start of the request.
  const after = await listed(signer, candidate.workspaceKey, candidate.documentIds, candidate.worldObjectKeys);
  if (!after.ok) return { ok: false, code: after.code, processed: 0 };
  if (!sourceInventoryListingsEqual(before.objects, after.objects)) {
    return { ok: false, code: "SOURCE_INVENTORY_CHANGED_DURING_SCAN", processed: 0 };
  }

  // The database refuses this too, and refusing it here as well is not redundancy: a worker
  // that submits an empty listing has already decided the prefix is empty, and the round trip
  // that would tell it otherwise is the one being guarded. An R2 listing that returns nothing
  // for a source that still has bound documents is a listing that failed open.
  if (objects.length === 0 && candidate.documentIds.length > 0) {
    return { ok: false, code: "SOURCE_INVENTORY_EMPTY_LISTING", processed: 0 };
  }

  // The full World key set goes along: a key missing from `objects` was listed absent and is
  // recorded as absent -- only a purge receipt ever says an object was removed.
  const recorded = await attest(candidate.deletionId, objects, candidate.worldObjectKeys);
  if (!recorded.ok) return { ok: false, code: recorded.code, processed: 0 };
  if (recorded.attestation.artifactCount !== objects.length) {
    return { ok: false, code: "SOURCE_INVENTORY_ATTESTATION_COUNT_MISMATCH", processed: 0 };
  }
  return {
    ok: true,
    code: "ATTESTED",
    processed: 1,
    artifactCount: objects.length,
    status: recorded.attestation.status,
  };
}
