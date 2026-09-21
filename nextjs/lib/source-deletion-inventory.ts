import {
  FOUNDATION_R2_BUCKET,
  readR2SignerEnv,
  type R2SignerEnv,
} from "./r2-synthetic-canary";
import {
  hashFoundationSourceInventoryObject,
  listFoundationSourceInventory,
  sourceInventoryListingsEqual,
  type SourceInventoryHashedObject,
} from "./source-deletion-inventory-r2";
import {
  readSourceDeletionInventoryCandidate,
  recordSourceDeletionInventoryAttestation,
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
  | { ok: false; code: string; processed: 0 };

type Dependencies = {
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

  const candidateResult = await readCandidate();
  if (!candidateResult.ok) return { ok: false, code: candidateResult.code, processed: 0 };
  const candidate = candidateResult.candidate;
  if (!candidate) return { ok: true, code: "IDLE", processed: 0 };

  const before = await listed(signer, candidate.workspaceKey, candidate.documentIds);
  if (!before.ok) return { ok: false, code: before.code, processed: 0 };

  const objects: SourceInventoryHashedObject[] = [];
  for (const object of before.objects) {
    const hashed = await hash(signer, candidate.workspaceKey, object);
    if (!hashed.ok) return { ok: false, code: hashed.code, processed: 0 };
    objects.push(hashed.object);
  }

  // A CDR/OCR writer racing the scan changes either the key set or a listed byte length.
  // Refuse instead of sealing a prefix that was only complete at the start of the request.
  const after = await listed(signer, candidate.workspaceKey, candidate.documentIds);
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

  const recorded = await attest(candidate.deletionId, objects);
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
