export type DeletionCandidate = {
  deletionId: string;
  workspaceKey: string;
  sourceId: string;
  objectKey: string;
  objectSha256: string;
  legalHoldState: "inactive" | "active" | "unknown";
  claimId: string;
  claimExpiresAt: string;
};

export type DeletionReceipt = {
  receiptId: string;
  status: "recorded" | "replayed";
};

export type DeletionSweepStore = {
  claim(limit: number): Promise<{ ok: true; candidates: DeletionCandidate[] } | { ok: false; code: string }>;
  beginDelete(input: DeletionCandidate): Promise<{ ok: true } | { ok: false; code: string }>;
  finalize(input: DeletionCandidate & { objectAlreadyAbsent: boolean }): Promise<
    { ok: true; receipt: DeletionReceipt } | { ok: false; code: string }
  >;
  /** Append-only purge-stage failure, bound to this candidate's claim. */
  recordFailure(input: DeletionCandidate & { code: string }): Promise<{ ok: true } | { ok: false; code: string }>;
};

export type InspectImmutableObject = (candidate: DeletionCandidate) => Promise<
  { ok: true; exists: boolean } | { ok: false; code: string }
>;

export type DeleteImmutableObject = (candidate: DeletionCandidate) => Promise<
  { ok: true; alreadyAbsent: boolean } | { ok: false; code: string }
>;

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const ID = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// R2 HEAD, DELETE and verification HEAD each have an 8-second timeout. Leave room for all three,
// scheduling jitter, and the final database receipt transaction.
const MIN_LEASE_REMAINING_MS = 30_000;

function validCandidate(value: DeletionCandidate): boolean {
  return ID.test(value.deletionId) && value.workspaceKey.length > 0 && value.sourceId.length > 0 &&
    value.objectKey.length > 0 && value.objectKey.length <= 1024 && SHA256.test(value.objectSha256) &&
    ["inactive", "active", "unknown"].includes(value.legalHoldState) && UUID.test(value.claimId) &&
    Number.isFinite(Date.parse(value.claimExpiresAt));
}

/**
 * Deletes a bounded, deterministically ordered set of source objects.
 *
 * Claim and finalize are separate durable transactions because object storage cannot join a
 * Postgres transaction. Finalize rechecks legal hold in the database. Object deletion must be
 * idempotent: an absent object is success, and the immutable receipt records that fact. The
 * first ambiguous state stops the batch so later objects cannot overtake it. Once object I/O has
 * been attempted, a failure is also written as append-only evidence (`failureRecorded` says
 * whether that write landed); the returned code is always the original failure.
 */
export async function runSourceDeletionSweep(input: {
  limit?: number;
  store: DeletionSweepStore;
  inspectObject: InspectImmutableObject;
  deleteObject: DeleteImmutableObject;
}): Promise<
  | { ok: true; receipts: DeletionReceipt[] }
  | { ok: false; code: string; receipts: DeletionReceipt[]; failureRecorded?: boolean }
> {
  const limit = input.limit ?? 1;
  if (limit !== 1) {
    return { ok: false, code: "SOURCE_DELETION_LIMIT_INVALID", receipts: [] };
  }
  const claimed = await input.store.claim(limit);
  if (!claimed.ok) return { ok: false, code: claimed.code, receipts: [] };
  if (claimed.candidates.length > limit || claimed.candidates.some(candidate => !validCandidate(candidate))) {
    return { ok: false, code: "SOURCE_DELETION_CLAIM_INVALID", receipts: [] };
  }
  const candidates = [...claimed.candidates].sort((a, b) =>
    a.deletionId.localeCompare(b.deletionId) || a.objectKey.localeCompare(b.objectKey));
  const receipts: DeletionReceipt[] = [];
  for (const candidate of candidates) {
    if (candidate.legalHoldState !== "inactive") {
      return {
        ok: false,
        code: candidate.legalHoldState === "active" ? "SOURCE_LEGAL_HOLD_ACTIVE" : "SOURCE_LEGAL_HOLD_STATE_UNKNOWN",
        receipts,
      };
    }
    if (Date.parse(candidate.claimExpiresAt) - Date.now() < MIN_LEASE_REMAINING_MS) {
      return { ok: false, code: "SOURCE_DELETION_LEASE_EXPIRED", receipts };
    }
    const fail = async (code: string) => {
      const recorded = await input.store.recordFailure({ ...candidate, code })
        .catch(() => ({ ok: false as const, code: "SOURCE_DELETION_FAILURE_RECORD_FAILED" }));
      return { ok: false as const, code, receipts, failureRecorded: recorded.ok };
    };
    const inspected = await input.inspectObject(candidate);
    if (!inspected.ok) return fail(inspected.code);
    const begun = await input.store.beginDelete(candidate);
    if (!begun.ok) return fail(begun.code);
    const removed = inspected.exists
      ? await input.deleteObject(candidate)
      : { ok: true as const, alreadyAbsent: true };
    if (!removed.ok) return fail(removed.code);
    // A provider acknowledgement is not proof that a locked object actually disappeared.
    // R2 is strongly consistent; only an independently observed absence can earn a receipt.
    const verified = await input.inspectObject(candidate);
    if (!verified.ok) return fail(verified.code);
    if (verified.exists) return fail("SOURCE_DELETE_NOT_CONFIRMED");
    const finalized = await input.store.finalize({ ...candidate, objectAlreadyAbsent: removed.alreadyAbsent });
    if (!finalized.ok) return fail(finalized.code);
    if (!ID.test(finalized.receipt.receiptId) ||
        (finalized.receipt.status !== "recorded" && finalized.receipt.status !== "replayed")) {
      return fail("SOURCE_DELETION_RECEIPT_INVALID");
    }
    receipts.push(finalized.receipt);
  }
  return { ok: true, receipts };
}
