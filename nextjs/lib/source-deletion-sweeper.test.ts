import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSourceDeletionSweep, type DeletionCandidate, type DeletionSweepStore } from "./source-deletion-sweeper";

const sha = (char: string) => `sha256:${char.repeat(64)}`;
const candidate = (id: string, objectKey: string, legalHoldState: DeletionCandidate["legalHoldState"] = "inactive"): DeletionCandidate => ({
  deletionId: sha(id), workspaceKey: "pilot-acme01", sourceId: `src-${id}`, objectKey,
  objectSha256: sha("f"), legalHoldState, claimId: "11111111-1111-4111-8111-111111111111",
  claimExpiresAt: "2099-01-01T00:00:00.000Z",
});

function store(rows: DeletionCandidate[]) {
  const beginDelete = vi.fn(async () => ({ ok: true as const }));
  const finalize = vi.fn(async (row: DeletionCandidate) => ({
    ok: true as const,
    receipt: { receiptId: sha(row.deletionId.at(-1) ?? "a"), status: "recorded" as const },
  }));
  const recordFailure = vi.fn<DeletionSweepStore["recordFailure"]>(async () => ({ ok: true as const }));
  return { value: { claim: vi.fn(async () => ({ ok: true as const, candidates: rows })), beginDelete, finalize,
    recordFailure } satisfies DeletionSweepStore, beginDelete, finalize, recordFailure };
}

const inspectObject = vi.fn(async () => ({ ok: true as const, exists: true }));
beforeEach(() => {
  inspectObject.mockReset().mockResolvedValue({ ok: true, exists: false })
    .mockResolvedValueOnce({ ok: true, exists: true });
});

describe("source deletion sweeper", () => {
  it.each(["unknown", "active"] as const)("fails closed when legal hold is %s", async legalHoldState => {
    const state = store([candidate("a", "quarantine/a/source", legalHoldState)]);
    const deleteObject = vi.fn(async () => ({ ok: true as const, alreadyAbsent: false }));
    await expect(runSourceDeletionSweep({ store: state.value, inspectObject, deleteObject })).resolves.toEqual({
      ok: false,
      code: legalHoldState === "active" ? "SOURCE_LEGAL_HOLD_ACTIVE" : "SOURCE_LEGAL_HOLD_STATE_UNKNOWN",
      receipts: [],
    });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(state.finalize).not.toHaveBeenCalled();
    expect(state.recordFailure).not.toHaveBeenCalled();
  });

  it("accepts an already absent object on retry and passes the durable claim to finalize", async () => {
    const state = store([candidate("a", "a")]);
    const order: string[] = [];
    const deleteObject = vi.fn(async (row: DeletionCandidate) => {
      order.push(row.objectKey);
      return { ok: true as const, alreadyAbsent: row.objectKey === "a" };
    });
    const result = await runSourceDeletionSweep({ store: state.value, inspectObject, deleteObject });
    expect(result.ok).toBe(true);
    expect(order).toEqual(["a"]);
    expect(state.finalize.mock.calls[0][0]).toMatchObject({ objectKey: "a", objectAlreadyAbsent: true,
      claimId: "11111111-1111-4111-8111-111111111111" });
  });

  it("stops at the first ambiguous delete and never writes a receipt for it", async () => {
    const state = store([candidate("a", "one")]);
    const deleteObject = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: "OBJECT_DELETE_TIMEOUT" })
      .mockResolvedValueOnce({ ok: true, alreadyAbsent: false });
    await expect(runSourceDeletionSweep({ store: state.value, inspectObject, deleteObject })).resolves.toEqual({
      ok: false, code: "OBJECT_DELETE_TIMEOUT", receipts: [], failureRecorded: true,
    });
    expect(deleteObject).toHaveBeenCalledOnce();
    expect(state.finalize).not.toHaveBeenCalled();
    expect(state.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      objectKey: "one", claimId: "11111111-1111-4111-8111-111111111111", code: "OBJECT_DELETE_TIMEOUT",
    }));
  });

  it("records an object-lock refusal as evidence and never finalizes the object", async () => {
    const state = store([candidate("a", "immutable/pilot-acme01/pilot-acme01/doc/source")]);
    const deleteObject = vi.fn(async () => ({ ok: false as const, code: "SOURCE_DELETE_OBJECT_LOCKED" }));
    await expect(runSourceDeletionSweep({ store: state.value, inspectObject, deleteObject })).resolves.toEqual({
      ok: false, code: "SOURCE_DELETE_OBJECT_LOCKED", receipts: [], failureRecorded: true,
    });
    expect(state.recordFailure).toHaveBeenCalledOnce();
    expect(state.finalize).not.toHaveBeenCalled();
  });

  it("records a finalize failure after the object is gone, so the missing receipt is explained", async () => {
    const state = store([candidate("a", "one")]);
    state.finalize.mockResolvedValueOnce({ ok: false, code: "SOURCE_DELETION_FINALIZE_FAILED" } as never);
    const deleteObject = vi.fn(async () => ({ ok: true as const, alreadyAbsent: false }));
    await expect(runSourceDeletionSweep({ store: state.value, inspectObject, deleteObject })).resolves.toEqual({
      ok: false, code: "SOURCE_DELETION_FINALIZE_FAILED", receipts: [], failureRecorded: true,
    });
    expect(state.recordFailure.mock.calls[0]![0].code).toBe("SOURCE_DELETION_FINALIZE_FAILED");
  });

  it("keeps the original code when the evidence write itself fails or throws", async () => {
    inspectObject.mockReset().mockResolvedValue({ ok: true, exists: true });
    for (const outcome of [
      async () => ({ ok: false as const, code: "SOURCE_DELETION_FAILURE_RECORD_FAILED" }),
      async () => { throw new Error("network"); },
    ]) {
      const state = store([candidate("a", "one")]);
      state.recordFailure.mockImplementationOnce(outcome);
      const deleteObject = vi.fn(async () => ({ ok: false as const, code: "SOURCE_DELETE_FAILED" }));
      await expect(runSourceDeletionSweep({ store: state.value, inspectObject, deleteObject })).resolves.toEqual({
        ok: false, code: "SOURCE_DELETE_FAILED", receipts: [], failureRecorded: false,
      });
    }
  });

  it("enforces the 30-second external-I/O lease boundary before object I/O", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    try {
      const tooShort = store([{ ...candidate("a", "one"), claimExpiresAt: "2030-01-01T00:00:29.999Z" }]);
      const deleteObject = vi.fn(async () => ({ ok: true as const, alreadyAbsent: false }));
      await expect(runSourceDeletionSweep({ store: tooShort.value, inspectObject, deleteObject })).resolves.toEqual({
        ok: false, code: "SOURCE_DELETION_LEASE_EXPIRED", receipts: [],
      });
      expect(deleteObject).not.toHaveBeenCalled();
      expect(tooShort.recordFailure).not.toHaveBeenCalled();

      const boundary = store([{ ...candidate("a", "one"), claimExpiresAt: "2030-01-01T00:00:30.000Z" }]);
      await expect(runSourceDeletionSweep({ store: boundary.value, inspectObject, deleteObject })).resolves.toMatchObject({ ok: true });
      expect(deleteObject).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a request for more than one external object", async () => {
    const state = store([]);
    await expect(runSourceDeletionSweep({ limit: 2, store: state.value, inspectObject, deleteObject: vi.fn() }))
      .resolves.toEqual({ ok: false, code: "SOURCE_DELETION_LIMIT_INVALID", receipts: [] });
    expect(state.value.claim).not.toHaveBeenCalled();
  });

  it("does not mark external deletion started when HEAD is ambiguous", async () => {
    const state = store([candidate("a", "one")]);
    const inspect = vi.fn(async () => ({ ok: false as const, code: "SOURCE_DELETE_HEAD_FAILED" }));
    const deleteObject = vi.fn();
    await expect(runSourceDeletionSweep({ store: state.value, inspectObject: inspect, deleteObject }))
      .resolves.toEqual({ ok: false, code: "SOURCE_DELETE_HEAD_FAILED", receipts: [], failureRecorded: true });
    expect(state.beginDelete).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("marks deletion started after HEAD and before DELETE", async () => {
    const state = store([candidate("a", "one")]);
    const order: string[] = [];
    state.beginDelete.mockImplementation(async () => { order.push("begin"); return { ok: true }; });
    const inspect = vi.fn(async () => { order.push("head"); return { ok: true as const, exists: order.length === 1 }; });
    const remove = vi.fn(async () => { order.push("delete"); return { ok: true as const, alreadyAbsent: false }; });
    await runSourceDeletionSweep({ store: state.value, inspectObject: inspect, deleteObject: remove });
    expect(order).toEqual(["head", "begin", "delete", "head"]);
  });

  it("refuses to finalize when DELETE succeeds but a fresh HEAD still finds the object", async () => {
    const state = store([candidate("a", "one")]);
    const inspect = vi.fn(async () => ({ ok: true as const, exists: true }));
    const remove = vi.fn(async () => ({ ok: true as const, alreadyAbsent: false }));
    await expect(runSourceDeletionSweep({ store: state.value, inspectObject: inspect, deleteObject: remove }))
      .resolves.toEqual({ ok: false, code: "SOURCE_DELETE_NOT_CONFIRMED", receipts: [], failureRecorded: true });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(state.finalize).not.toHaveBeenCalled();
  });

  it("does not issue a receipt when post-delete verification is unavailable", async () => {
    const state = store([candidate("a", "one")]);
    const inspect = vi.fn().mockResolvedValueOnce({ ok: true, exists: true })
      .mockResolvedValueOnce({ ok: false, code: "SOURCE_DELETE_HEAD_FAILED" });
    await expect(runSourceDeletionSweep({ store: state.value, inspectObject: inspect,
      deleteObject: async () => ({ ok: true, alreadyAbsent: false }) }))
      .resolves.toEqual({ ok: false, code: "SOURCE_DELETE_HEAD_FAILED", receipts: [], failureRecorded: true });
    expect(state.finalize).not.toHaveBeenCalled();
  });
});
