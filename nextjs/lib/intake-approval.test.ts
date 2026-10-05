import { describe, expect, it, vi } from "vitest";
import {
  deriveFileKey,
  cancelFailedIntakeSetMember,
  intakeManifestDigest,
  matchReselection,
  memberStatus,
  readIntakeAttemptRecord,
  readApprovalPayload,
  readApprovalStatusResult,
  postApprovalAndReconcile,
  reconcilePriorAttemptForNewLineage,
  saveIntakeAttempt,
  shouldReuseAttemptKey,
  uploadApprovedMember,
  type ApprovedUploadDeps,
  type IntakeAttemptRecord,
} from "./intake-approval";

const digest = `sha256:${"a".repeat(64)}`;
const otherDigest = `sha256:${"b".repeat(64)}`;
const approvalId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const reservationId = "33333333-3333-4333-8333-333333333333";
const attemptKey = "att_0123456789abcdef0123456789abcdef";
const fileKey = "fk_0123456789abcdef0123456789abcdef01234567";
describe("attempt identity after terminal approval states", () => {
  it("reuses only when status is unknown or approval is still live", () => {
    expect(shouldReuseAttemptKey(null)).toBe(true);
    expect(shouldReuseAttemptKey({ state: "approved", expired: false })).toBe(true);
    expect(shouldReuseAttemptKey({ state: "cancelled", expired: false })).toBe(false);
    expect(shouldReuseAttemptKey({ state: "approved", expired: true })).toBe(false);
  });
});

describe("approval status read certainty", () => {
  const deps = (response: Response) => ({
    fetch: vi.fn(async () => response),
    token: async () => "test-token",
  });

  it("distinguishes authoritative not-found from unavailable status reads", async () => {
    await expect(readApprovalStatusResult(deps(new Response(JSON.stringify({ code: "INTAKE_APPROVAL_NOT_FOUND" }), { status: 404 })), attemptKey))
      .resolves.toEqual({ kind: "not_found" });
    await expect(readApprovalStatusResult(deps(new Response(JSON.stringify({ code: "INTAKE_APPROVAL_LEDGER_FAILED" }), { status: 503 })), attemptKey))
      .resolves.toEqual({ kind: "unavailable" });
    await expect(readApprovalStatusResult(deps(new Response(JSON.stringify({ code: "NOT_SIGNED_IN" }), { status: 401 })), attemptKey))
      .resolves.toEqual({ kind: "unavailable" });
  });

  it("returns a found approval only when the response parses as the complete stored receipt", async () => {
    await expect(readApprovalStatusResult(deps(new Response(JSON.stringify({ approval: status("reserved") }), { status: 200 })), attemptKey))
      .resolves.toMatchObject({ kind: "found", approval: { attemptKey, state: "approved" } });
    await expect(readApprovalStatusResult(deps(new Response(JSON.stringify({ approval: { attemptKey } }), { status: 200 })), attemptKey))
      .resolves.toEqual({ kind: "unavailable" });
  });

  it("allows a new receipt only after authoritative absence or fully cancelled prior state", async () => {
    const notFound = { fetch: vi.fn(async () => new Response(JSON.stringify({ code: "INTAKE_APPROVAL_NOT_FOUND" }), { status: 404 })), token: async () => "test-token" };
    const unavailable = { fetch: vi.fn(async () => new Response(JSON.stringify({ code: "INTAKE_APPROVAL_LEDGER_FAILED" }), { status: 503 })), token: async () => "test-token" };
    const active = { fetch: vi.fn(async () => new Response(JSON.stringify({ approval: status("reserved") }), { status: 200 })), token: async () => "test-token" };
    const cancelledApproval = status("cancelled");
    cancelledApproval.state = "cancelled";
    cancelledApproval.files[0]!.fileState = "cancelled";
    const cancelled = { fetch: vi.fn(async () => new Response(JSON.stringify({ approval: cancelledApproval }), { status: 200 })), token: async () => "test-token" };

    await expect(reconcilePriorAttemptForNewLineage(notFound, attemptKey)).resolves.toEqual({ kind: "safe_to_replace", prior: "not_found" });
    await expect(reconcilePriorAttemptForNewLineage(cancelled, attemptKey)).resolves.toEqual({ kind: "safe_to_replace", prior: "cancelled" });
    await expect(reconcilePriorAttemptForNewLineage(unavailable, attemptKey)).resolves.toEqual({ kind: "blocked", reason: "unavailable" });
    await expect(reconcilePriorAttemptForNewLineage(active, attemptKey)).resolves.toEqual({ kind: "blocked", reason: "active" });
    expect(unavailable.fetch).toHaveBeenCalledTimes(1); // The caller must stop before another approval POST.
  });

  it("replays the same approval POST after an authoritative GET 404 and accepts the idempotent result", async () => {
    const requests: Array<{ method: string; url: string; body?: string }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), method = String(init?.method ?? "GET");
      requests.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (method === "POST") return requests.filter((request) => request.method === "POST").length === 1
        ? ok({ code: "INTAKE_APPROVAL_LEDGER_FAILED" }, 503)
        : ok({ approval: status("reserved") });
      return ok({ code: "INTAKE_APPROVAL_NOT_FOUND" }, 404);
    });
    const body = { attemptKey, triageReceiptId: "receipt-same" };

    await expect(postApprovalAndReconcile({ fetch, token: async () => "test-token" }, attemptKey, body))
      .resolves.toMatchObject({ kind: "approved", approval: { attemptKey, state: "approved" } });
    expect(requests.map(({ method }) => method)).toEqual(["POST", "GET", "POST"]);
    expect(requests[1]!.url).toContain(encodeURIComponent(attemptKey));
    expect(JSON.parse(requests[0]!.body!)).toEqual(body);
    expect(JSON.parse(requests[2]!.body!)).toEqual(body);
  });

  it("preserves an ambiguous POST when its actual status GET returns 503", async () => {
    const requests: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(String(init?.method ?? "GET"));
      return String(init?.method) === "POST"
        ? ok({ code: "INTAKE_APPROVAL_LEDGER_FAILED" }, 503)
        : ok({ code: "INTAKE_APPROVAL_LEDGER_FAILED" }, 503);
    });
    await expect(postApprovalAndReconcile({ fetch, token: async () => "test-token" }, attemptKey, { attemptKey }))
      .resolves.toEqual({ kind: "unavailable" });
    expect(requests).toEqual(["POST", "GET"]);
  });
});

const approvedMember = {
  fileKey, originalFilename: "report.pdf", contentSha256: digest, byteLength: 123, mimeType: "application/pdf",
  approvedPageBasis: "unknown" as const, approvedMaxPages: 80, approvedReservedCredits: 320, approvedMaximumCredits: 480,
};
const capabilityReply = {
  documentId, uploadUrl: "https://bucket.invalid/put", declaredMimeType: "application/pdf", contentLength: 123,
  computeReservation: {
    reservedCredits: 320, maximumCredits: 480,
    quote: { approvedMaxPages: 80, estimatedUsd: 3.2, maximumUsd: 4.8, pageBasis: "unknown" },
  },
};

function status(fileState: "approved" | "reserved" | "confirmed" | "cancelled" = "reserved") {
  return {
    approvalId, attemptKey, clientManifestDigest: digest, scopeDigest: otherDigest, pricingFingerprint: digest,
    state: "approved", expiresAt: new Date(Date.now() + 60_000).toISOString(), expired: false,
    fileCount: 1, aggregateMaximumPages: 80, aggregateReservedCredits: 320, aggregateMaximumCredits: 480,
    compilable: fileState === "confirmed", idempotentReplay: false,
    files: [{
      fileKey, documentId, fileState, contentSha256: digest, byteLength: 123, mimeType: "application/pdf",
      pageBasis: "unknown", approvedMaxPages: 80, approvedReservedCredits: 320, approvedMaximumCredits: 480,
      reservationId, reservationState: "reserved", reservationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }],
  };
}

function ok(body: unknown, statusCode = 200) {
  return new Response(JSON.stringify(body), { status: statusCode, headers: { "content-type": "application/json" } });
}

describe("approved intake identity and recovery", () => {
  it("binds identity to path, bytes, length and MIME, and digests a canonical manifest", async () => {
    const base = { relativePath: "folder/report.pdf", contentSha256: digest, byteLength: 123, mimeType: "application/pdf" };
    const key = await deriveFileKey(base);
    expect(key).toBe(await deriveFileKey(base));
    expect(await deriveFileKey({ ...base, contentSha256: otherDigest })).not.toBe(key);
    expect(await deriveFileKey({ ...base, relativePath: "other/report.pdf" })).not.toBe(key);
    const entries = [{ fileKey: key, contentSha256: digest, byteLength: 123, mimeType: "application/pdf", claimedPages: null, claimedBasis: null }];
    expect(await intakeManifestDigest(entries)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("persists only approved metadata and rejects a changed reselected set", () => {
    const record: IntakeAttemptRecord = {
      version: 1, attemptKey, approvalId, scopeDigest: otherDigest, pricingFingerprint: digest,
      clientManifestDigest: digest, aggregateMaximumCredits: 480, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      files: [{ fileKey, relativePath: "report.pdf", contentSha256: digest, byteLength: 123, mimeType: "application/pdf", documentId, phase: "uncertain", code: "CONFIRM_RESPONSE_LOST" }],
    };
    let saved = "";
    const storage = { setItem: (_key: string, value: string) => { saved = value; } };
    expect(saveIntakeAttempt(storage, { ...record, files: [{ ...record.files[0]!, bytes: "must not persist" } as IntakeAttemptRecord["files"][number]] })).toBe(true);
    expect(saved).not.toContain("must not persist");
    expect(readIntakeAttemptRecord(JSON.parse(saved))).not.toBeNull();
    expect(matchReselection(record, [fileKey])).toEqual({ ok: true });
    expect(matchReselection(record, ["fk_9876543210abcdef9876543210abcdef98765432"])).toEqual({ ok: false, code: "SELECTION_CHANGED" });
    const expired = status("reserved");
    expired.files[0]!.reservationExpiresAt = new Date(Date.now() - 1).toISOString();
    const parsed = readApprovalPayload(expired);
    expect(parsed && memberStatus(parsed, parsed.files[0]!)).toBe("expired");
  });

  it("retries a lost capability under the same idempotency key and confirms the same member", async () => {
    const headersSeen: string[] = [];
    const fetchMock = vi.fn<ApprovedUploadDeps["fetch"]>(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.endsWith("/api/uploads/capability")) {
        headersSeen.push(headers.get("x-tavonel-source-idempotency-key") ?? "missing");
        if (headersSeen.length === 1) throw new Error("reply lost after commit");
        return ok(capabilityReply);
      }
      if (url.endsWith("/api/uploads/confirm")) return ok({ code: "UPLOAD_CONFIRMED", approvedFile: { fileState: "confirmed", documentId } });
      return ok({ approval: status("reserved") });
    });
    const result = await uploadApprovedMember({
      attempt: { attemptKey, scopeDigest: otherDigest, pricingFingerprint: digest },
      member: approvedMember,
    }, { fetch: fetchMock, token: async () => "test-token", put: async () => ({ ok: true, sourceSha256: digest }), maxAttempts: 2 });
    expect(result).toEqual({ status: "confirmed", documentId });
    expect(headersSeen).toHaveLength(2);
    expect(headersSeen[0]).toBe(headersSeen[1]);
  });

  it("calls injected fetch without a receiver and reads approval state after a lost capability reply", async () => {
    const receivers: unknown[] = [];
    const paths: string[] = [];
    const receiverSensitiveFetch: ApprovedUploadDeps["fetch"] = function (
      this: unknown,
      input: RequestInfo | URL,
    ) {
      receivers.push(this);
      const path = String(input);
      paths.push(path);
      if (this !== undefined) return Promise.reject(new TypeError("Illegal invocation"));
      if (path === "/api/uploads/capability") return Promise.reject(new Error("reply lost after commit"));
      if (path.startsWith("/api/uploads/approval?attemptKey=")) return Promise.resolve(ok({ approval: status("reserved") }));
      return Promise.resolve(ok({ code: "UNEXPECTED_REQUEST" }, 500));
    };
    const result = await uploadApprovedMember({
      attempt: { attemptKey, scopeDigest: otherDigest, pricingFingerprint: digest },
      member: approvedMember,
    }, {
      fetch: receiverSensitiveFetch,
      token: async () => "test-token",
      put: async () => ({ ok: true, sourceSha256: digest }),
      maxAttempts: 1,
    });

    expect(receivers).toEqual([undefined, undefined]);
    expect(paths).toEqual([
      "/api/uploads/capability",
      `/api/uploads/approval?attemptKey=${attemptKey}`,
    ]);
    expect(result).toEqual({ status: "uncertain", code: "CAPABILITY_RESPONSE_LOST", documentId });
  });

  it("reconciles a lost confirm response from server state and leaves ambiguous state blocked", async () => {
    let confirmed = false;
    const fetchMock: ApprovedUploadDeps["fetch"] = async (input) => {
      const url = String(input);
      if (url.endsWith("/api/uploads/capability")) return ok(capabilityReply);
      if (url.endsWith("/api/uploads/confirm")) { confirmed = true; throw new Error("confirm reply lost"); }
      return ok({ approval: status(confirmed ? "confirmed" : "reserved") });
    };
    const confirmedResult = await uploadApprovedMember({
      attempt: { attemptKey, scopeDigest: otherDigest, pricingFingerprint: digest },
      member: approvedMember,
    }, { fetch: fetchMock, token: async () => "test-token", put: async () => ({ ok: true, sourceSha256: digest }) });
    expect(confirmedResult).toEqual({ status: "confirmed", documentId });

    const uncertain = await uploadApprovedMember({
      attempt: { attemptKey, scopeDigest: otherDigest, pricingFingerprint: digest },
      member: approvedMember,
    }, { fetch: async () => { throw new Error("offline"); }, token: async () => "test-token", put: async () => ({ ok: false, reason: "network", status: 0 }), maxAttempts: 1 });
    expect(uncertain.status).toBe("uncertain");
  });

  it("checks storage after a lost PUT reply and confirms only the same approved member", async () => {
    const calls: string[] = [];
    const fetchMock: ApprovedUploadDeps["fetch"] = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/uploads/capability")) return ok(capabilityReply);
      if (url.endsWith("/api/uploads/release")) return ok({ code: "UPLOAD_ALREADY_STORED" }, 409);
      if (url.endsWith("/api/uploads/confirm")) return ok({ code: "UPLOAD_CONFIRMED", approvedFile: { fileState: "confirmed", documentId } });
      return ok({ approval: status("reserved") });
    };
    const result = await uploadApprovedMember({
      attempt: { attemptKey, scopeDigest: otherDigest, pricingFingerprint: digest },
      member: approvedMember,
    }, { fetch: fetchMock, token: async () => "test-token", put: async () => ({ ok: false, reason: "network", status: 0 }) });
    expect(result).toEqual({ status: "confirmed", documentId });
    expect(calls.some((url) => url.endsWith("/api/uploads/release"))).toBe(true);
  });

  it("refuses a capability whose returned budget differs from the approved quote", async () => {
    let putCalled = false;
    const fetchMock: ApprovedUploadDeps["fetch"] = async (input) => String(input).endsWith("/api/uploads/capability")
      ? ok({ ...capabilityReply, computeReservation: { ...capabilityReply.computeReservation, maximumCredits: 481 } })
      : ok({ approval: status("reserved") });
    const result = await uploadApprovedMember({
      attempt: { attemptKey, scopeDigest: otherDigest, pricingFingerprint: digest }, member: approvedMember,
    }, { fetch: fetchMock, token: async () => "test-token", put: async () => { putCalled = true; return { ok: true, sourceSha256: digest }; } });
    expect(result).toMatchObject({ status: "failed", code: "INTAKE_APPROVAL_RECEIPT_MISMATCH" });
    expect(putCalled).toBe(false);
  });
  it("confirms a version-bound triage-sealed object without issuing a second PUT", async () => {
    const calls: string[] = [];
    const phases: string[] = [];
    const triageReceiptId = "11111111-1111-4111-8111-111111111111";
    let putCalled = false;
    const fetchMock: ApprovedUploadDeps["fetch"] = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/uploads/capability")) return ok({
        ...capabilityReply,
        code: "TRIAGE_OBJECT_READY",
        uploadUrl: null,
        triageReceiptId,
        contentSha256: digest,
        objectVersion: "immutable-object-version",
      });
      if (url.endsWith("/api/uploads/confirm")) return ok({ code: "UPLOAD_CONFIRMED", approvedFile: { fileState: "confirmed", documentId } });
      return ok({ approval: status("reserved") });
    };
    const result = await uploadApprovedMember({
      attempt: { attemptKey, scopeDigest: otherDigest, pricingFingerprint: digest, triageReceiptId }, member: approvedMember,
    }, {
      fetch: fetchMock,
      token: async () => "test-token",
      put: async () => { putCalled = true; return { ok: true, sourceSha256: digest }; },
      onPhase: (phase) => phases.push(phase),
    });
    expect(result).toEqual({ status: "confirmed", documentId });
    expect(putCalled).toBe(false);
    expect(calls.some((url) => url.endsWith("/api/uploads/confirm"))).toBe(true);
    expect(phases).not.toContain("put_sent");
    expect(phases).toContain("stored");
  });
  it("refuses a presealed object from a different receipt without PUT or confirm", async () => {
    const calls: string[] = [];
    let putCalled = false;
    const triageReceiptId = "11111111-1111-4111-8111-111111111111";
    const fetchMock: ApprovedUploadDeps["fetch"] = async (input) => {
      calls.push(String(input));
      return ok({
        ...capabilityReply, code: "TRIAGE_OBJECT_READY", uploadUrl: null,
        triageReceiptId: "22222222-2222-4222-8222-222222222222",
        contentSha256: digest, objectVersion: "immutable-object-version",
      });
    };
    const result = await uploadApprovedMember({
      attempt: { attemptKey, scopeDigest: otherDigest, pricingFingerprint: digest, triageReceiptId },
      member: approvedMember,
    }, { fetch: fetchMock, token: async () => "test-token", put: async () => {
      putCalled = true; return { ok: true, sourceSha256: digest };
    } });
    expect(result).toMatchObject({ status: "failed", code: "TRIAGE_OBJECT_READY_REQUIRED" });
    expect(putCalled).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\/api\/uploads\/capability$/);
  });
  it("refuses a legacy writable URL for a triage approval without PUT or confirm", async () => {
    const calls: string[] = [];
    let putCalled = false;
    const triageReceiptId = "11111111-1111-4111-8111-111111111111";
    const fetchMock: ApprovedUploadDeps["fetch"] = async (input) => {
      calls.push(String(input));
      return ok({ ...capabilityReply, code: "QUALIFIED", uploadUrl: "https://upload.invalid/legacy" });
    };
    const result = await uploadApprovedMember({
      attempt: { attemptKey, scopeDigest: otherDigest, pricingFingerprint: digest, triageReceiptId },
      member: approvedMember,
    }, { fetch: fetchMock, token: async () => "test-token", put: async () => {
      putCalled = true; return { ok: true, sourceSha256: digest };
    } });
    expect(result).toMatchObject({ status: "failed", code: "TRIAGE_OBJECT_READY_REQUIRED" });
    expect(putCalled).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\/api\/uploads\/capability$/);
  });
  it("reconciles set cancellation from server state and preserves uncertainty on a lost reply", async () => {
    let calls = 0;
    const fetchMock: ApprovedUploadDeps["fetch"] = async () => {
      calls += 1;
      return ok({ code: "INTAKE_SET_CANCELLED" });
    };
    const cancelled = await cancelFailedIntakeSetMember(
      { attemptKey, scopeDigest: otherDigest, fileKey },
      { fetch: fetchMock, token: async () => "test-token" },
    );
    expect(cancelled).toEqual({ status: "cancelled", reconciliationRequired: false });
    expect(calls).toBe(1);

    const reviewStatus = status("confirmed");
    reviewStatus.state = "cancelled";
    reviewStatus.files[0]!.reservationState = "operator_review";
    const reconciled = await cancelFailedIntakeSetMember(
      { attemptKey, scopeDigest: otherDigest, fileKey },
      { fetch: async (input) => String(input).endsWith("/api/uploads/approval/cancel")
        ? ok({ code: "INTAKE_SET_CANCELLED_RECONCILIATION_REQUIRED" })
        : ok({ approval: reviewStatus }), token: async () => "test-token" },
    );
    expect(reconciled).toEqual({ status: "cancelled", reconciliationRequired: true });

    const lostWithReview = await cancelFailedIntakeSetMember(
      { attemptKey, scopeDigest: otherDigest, fileKey },
      { fetch: async (input) => {
        if (String(input).endsWith("/api/uploads/approval/cancel")) throw new Error("reply lost after commit");
        return ok({ approval: reviewStatus });
      }, token: async () => "test-token" },
    );
    expect(lostWithReview).toEqual({ status: "cancelled", reconciliationRequired: true });

    const uncertain = await cancelFailedIntakeSetMember(
      { attemptKey, scopeDigest: otherDigest, fileKey },
      { fetch: async () => { throw new Error("connection lost"); }, token: async () => "test-token" },
    );
    expect(uncertain).toEqual({ status: "uncertain", code: "INTAKE_SET_CANCELLATION_UNCERTAIN" });
  });

});

describe("whole-selection file bound", () => {
  it.each([1, 13, 20, 21, 128])("accepts %i members in one attempt record", (size) => {
    const record: IntakeAttemptRecord = {
      version: 1, attemptKey, approvalId, scopeDigest: otherDigest, pricingFingerprint: digest,
      clientManifestDigest: digest, aggregateMaximumCredits: size, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      files: Array.from({ length: size }, (_, index) => ({
        fileKey: `fk_${String(index).padStart(8, "0")}`, relativePath: `file-${index}.pdf`, contentSha256: digest,
        byteLength: 123, mimeType: "application/pdf", documentId: null, phase: "approved" as const, code: null,
      })),
    };
    expect(readIntakeAttemptRecord(record)?.files).toHaveLength(size);
  });

  it("refuses 129 members as one attempt instead of splitting the selection", () => {
    const record: IntakeAttemptRecord = {
      version: 1, attemptKey, approvalId, scopeDigest: otherDigest, pricingFingerprint: digest,
      clientManifestDigest: digest, aggregateMaximumCredits: 129, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      files: Array.from({ length: 129 }, (_, index) => ({
        fileKey: `fk_${String(index).padStart(8, "0")}`, relativePath: `file-${index}.pdf`, contentSha256: digest,
        byteLength: 123, mimeType: "application/pdf", documentId: null, phase: "approved" as const, code: null,
      })),
    };
    expect(readIntakeAttemptRecord(record)).toBeNull();
  });
});
