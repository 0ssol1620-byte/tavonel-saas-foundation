import { afterEach, describe, expect, it, vi } from "vitest";
import { readFoundationIntakeApproval, reserveFoundationCompute, settleFoundationCompute } from "./compute-reservation";

// Both switches are code constants; these getters let one file pin each combination.
const rollout = vi.hoisted(() => ({ approval: true, triage: true }));
vi.mock("./intake-approval-rollout", () => ({ get INTAKE_APPROVAL_ROLLOUT_ENABLED() { return rollout.approval; } }));
vi.mock("./intake-triage-rollout", () => ({ get INTAKE_TRIAGE_ROLLOUT_ENABLED() { return rollout.triage; } }));

const base = {
  workspaceKey: "pilot-4444444444444444",
  documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userId: "44444444-4444-4444-8444-444444444444",
  estimatedPages: 3,
};

describe("Foundation compute ledger", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rollout.approval = true; rollout.triage = true; });

  function configure() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
  }

  function futureExpiry(minutes = 10) {
    return new Date(Date.now() + minutes * 60_000).toISOString();
  }

  it.each([
    ["foundation_studio_subscription_required", "STUDIO_SUBSCRIPTION_REQUIRED"],
    ["foundation_billing_hold", "BILLING_HOLD"],
    ["foundation_credits_required", "GPU_CREDITS_REQUIRED"],
    ["foundation_trial_page_limit_exceeded", "TRIAL_PAGE_LIMIT_EXCEEDED"],
    ["foundation_trial_global_budget_exceeded", "TRIAL_CAPACITY_REACHED"],
    ["foundation_trial_not_active", "TRIAL_NOT_ACTIVE"],
  ])("maps fail-closed reservation guard %s", async (message, code) => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message }), { status: 400 })));
    await expect(reserveFoundationCompute(base)).resolves.toEqual({ ok: false, code });
  });

  it.each(["paid", "trial", "owner"] as const)("accepts a %s reservation receipt bound to the requested document", async (billingSource) => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      documentId: base.documentId,
      state: "reserved",
      expiresAt: futureExpiry(),
      reservedCredits: 12,
      maximumCredits: 18,
      billingSource,
      idempotentReplay: false,
    }), { status: 200 })));
    await expect(reserveFoundationCompute(base)).resolves.toMatchObject({ ok: true, result: { billingSource } });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("reserve_foundation_compute_v3"), expect.objectContaining({
      body: expect.stringContaining('"p_reserved_credits":12,"p_maximum_credits":18'),
    }));
  });

  /*
    Audit U06: a reload, a second tab and a dropped network must not charge twice.

    The reservation RPC is keyed on (workspace, document), so a second attempt is a replay of
    the first rather than a second reservation -- and the receipt says which it was. These hold
    the three outcomes a duplicated request can have: a replay passed through as a replay, a
    conflict refused rather than silently re-reserved, and a settlement that arrives twice
    because delivery is at-least-once.
  */
  it("passes an idempotent replay through as a replay rather than a second reservation", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      documentId: base.documentId,
      state: "reserved",
      expiresAt: futureExpiry(),
      reservedCredits: 12,
      maximumCredits: 18,
      billingSource: "paid",
      idempotentReplay: true,
    }), { status: 200 })));
    await expect(reserveFoundationCompute(base)).resolves.toMatchObject({
      ok: true,
      result: { reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", idempotentReplay: true },
    });
  });

  it("refuses an idempotency conflict with its own code instead of reserving again", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: "foundation_compute_idempotency_conflict" }), { status: 409 },
    )));
    await expect(reserveFoundationCompute(base)).resolves.toEqual({ ok: false, code: "COMPUTE_IDEMPOTENCY_CONFLICT" });
  });

  it("accepts a duplicate settlement, which is what at-least-once delivery produces", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "duplicate",
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      state: "settled",
      settledCredits: 12,
      billingSource: "paid",
    }), { status: 200 })));
    await expect(settleFoundationCompute({
      workspaceKey: base.workspaceKey,
      documentId: base.documentId,
      outcome: "settled",
      actualCredits: 12,
      reasonCode: "OCR_COMPLETED",
    })).resolves.toMatchObject({ ok: true, result: { status: "duplicate" } });
  });

  it.each([
    [new Date(Date.now() - 1_000).toISOString(), "expired"],
    [new Date(Date.now() + 16 * 60_000).toISOString(), "outside the ledger TTL"],
  ])("refuses a reservation receipt whose capability is %s", async (expiresAt) => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      documentId: base.documentId,
      state: "reserved",
      expiresAt,
      reservedCredits: 12,
      maximumCredits: 18,
      billingSource: "paid",
      idempotentReplay: false,
    }), { status: 200 })));
    await expect(reserveFoundationCompute(base)).resolves.toEqual({
      ok: false,
      code: "COMPUTE_RESERVATION_RECEIPT_INVALID",
    });
  });

  it.each([
    [{ state: "released", settledCredits: 12, billingSource: "paid" }, "state"],
    [{ state: "settled", settledCredits: 11, billingSource: "paid" }, "credits"],
    [{ state: "settled", settledCredits: 12, billingSource: "unknown" }, "billing source"],
  ])("refuses a processed settlement receipt with mismatched %s", async (receipt) => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "processed",
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ...receipt,
    }), { status: 200 })));
    await expect(settleFoundationCompute({
      workspaceKey: base.workspaceKey,
      documentId: base.documentId,
      outcome: "settled",
      actualCredits: 12,
      reasonCode: "OCR_COMPLETED",
    })).resolves.toEqual({ ok: false, code: "COMPUTE_SETTLEMENT_RECEIPT_INVALID" });
  });

  /*
    A settlement the ledger refuses on shape must not read as an outage.

    COMPUTE_LEDGER_FAILED is the class a caller is right to retry; a settlement the SQL will
    never accept (`released` carrying credits, say) is not. Unmapped, the two were one string
    (ops CROSS-LANE 4).
  */
  it("classifies a malformed settlement as a bad request, not a ledger outage", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'raise exception "foundation_compute_settlement_invalid"' }),
      { status: 400 },
    )));
    await expect(settleFoundationCompute({
      workspaceKey: base.workspaceKey,
      documentId: base.documentId,
      outcome: "released",
      actualCredits: 12,
      reasonCode: "OCR_TIMEOUT_OR_NETWORK",
    })).resolves.toEqual({ ok: false, code: "COMPUTE_SETTLEMENT_INVALID" });
  });

  /*
    Same rule, the other terminal refusal (migrations CROSS-LANE 4).

    `20260911120000` made `expired` terminal and refuses a late settlement under its own error
    name, precisely so an operator can tell a lapsed capability from a contested charge. Unmapped
    it became COMPUTE_LEDGER_FAILED -- the one class a caller is right to retry -- so the retry
    loop would have run against a refusal the ledger will never accept, and the log line would
    have said the ledger was unreachable when it was answering correctly.
  */
  it("classifies a settlement for a lapsed capability as its own terminal refusal", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'raise exception "foundation_compute_settlement_expired"' }),
      { status: 400 },
    )));
    await expect(settleFoundationCompute({
      workspaceKey: base.workspaceKey,
      documentId: base.documentId,
      outcome: "released",
      actualCredits: 0,
      reasonCode: "CDR_LATE_RELEASE",
    })).resolves.toEqual({ ok: false, code: "COMPUTE_SETTLEMENT_EXPIRED" });
  });

  it("refuses a settlement receipt that claims neither processed nor duplicate", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "charged_again",
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }), { status: 200 })));
    await expect(settleFoundationCompute({
      workspaceKey: base.workspaceKey,
      documentId: base.documentId,
      outcome: "settled",
      actualCredits: 12,
      reasonCode: "OCR_COMPLETED",
    })).resolves.toEqual({ ok: false, code: "COMPUTE_SETTLEMENT_RECEIPT_INVALID" });
  });

  it("accepts only an idempotent settlement receipt", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "processed",
      reservationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      state: "operator_review",
      settledCredits: 12,
      billingSource: "trial",
    }), { status: 200 })));
    await expect(settleFoundationCompute({
      workspaceKey: base.workspaceKey,
      documentId: base.documentId,
      outcome: "operator_review",
      actualCredits: 12,
      reasonCode: "OCR_TIMEOUT_OR_NETWORK",
    })).resolves.toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("settle_foundation_compute_v3"), expect.any(Object));
  });

  /*
    The lineage-aware read (v2) exists only in the never-applied triage draft, so it is called only
    with triage on. Before 2026-10-16 it was called with triage off too, which made every approval
    read fail closed against a database that has only the approval migration.
  */
  describe("lineage-aware approval reads with triage on", () => {
    const attemptKey = "attempt_0123456789abcdef";
    const legacyPayload = {
      approvalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", attemptKey,
      clientManifestDigest: `sha256:${"a".repeat(64)}`, scopeDigest: `sha256:${"b".repeat(64)}`,
      pricingFingerprint: `sha256:${"c".repeat(64)}`, state: "approved",
      expiresAt: new Date(Date.now() + 60_000).toISOString(), expired: false,
      fileCount: 1, aggregateMaximumPages: 1, aggregateReservedCredits: 1, aggregateMaximumCredits: 1,
      compilable: false, idempotentReplay: false,
      files: [{ fileKey: "fk_12345678", documentId: base.documentId, fileState: "approved",
        contentSha256: `sha256:${"d".repeat(64)}`, byteLength: 100, mimeType: "application/pdf",
        pageBasis: "measured", approvedMaxPages: 1, approvedReservedCredits: 1,
        approvedMaximumCredits: 1, reservationId: null, reservationState: null, reservationExpiresAt: null }],
    };
    const call = () => readFoundationIntakeApproval({
      workspaceKey: base.workspaceKey, userId: base.userId, attemptKey,
    });

    it("reads actual triage lineage from the v2 RPC", async () => {
      configure();
      const triageReceiptId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
        ...legacyPayload, triageLineageVersion: 1, triageReceiptId,
        triageVersion: "tavonel-intake-triage-v1", triageInventoryDigest: `sha256:${"e".repeat(64)}`,
        configurationRevision: "triage-config-1",
      }), { status: 200 })));
      await expect(call()).resolves.toMatchObject({ ok: true, result: { triageReceiptId } });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("read_foundation_intake_approval_v2"), expect.any(Object));
    });

    it("fails closed on a legacy-shaped response from the v2 RPC instead of fabricating legacy lineage", async () => {
      configure();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(legacyPayload), { status: 200 })));
      await expect(call()).resolves.toEqual({ ok: false, code: "INTAKE_APPROVAL_LINEAGE_UNAVAILABLE", status: 503 });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("read_foundation_intake_approval_v2"), expect.any(Object));
    });

    it("keeps a lineage-complete legacy approval readable when v2 explicitly proves null lineage", async () => {
      configure();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
        ...legacyPayload, triageLineageVersion: 1, triageReceiptId: null, triageVersion: null,
        triageInventoryDigest: null, configurationRevision: null,
      }), { status: 200 })));
      await expect(call()).resolves.toMatchObject({ ok: true, result: { triageReceiptId: null } });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("read_foundation_intake_approval_v2"), expect.any(Object));
    });

    it("fails closed when the lineage reader is unavailable instead of falling back to a legacy projection", async () => {
      configure();
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("read_foundation_intake_approval_v2")
        ? new Response(JSON.stringify({ code: "PGRST202", message: "function read_foundation_intake_approval_v2 does not exist" }), { status: 404 })
        : new Response(JSON.stringify(legacyPayload), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(call()).resolves.toEqual({ ok: false, code: "INTAKE_APPROVAL_LINEAGE_UNAVAILABLE", status: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toContain("read_foundation_intake_approval_v2");
    });

    it("with triage off, reads the approval migration's own RPC and never the draft-only v2", async () => {
      configure();
      rollout.triage = false;
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(legacyPayload), { status: 200 })));
      await expect(call()).resolves.toMatchObject({ ok: true, result: { attemptKey } });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toMatch(/[/]rpc[/]read_foundation_intake_approval$/);
    });

    it("with the lineage on, a database without the approval function fails closed as unavailable", async () => {
      configure();
      rollout.triage = false;
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: "PGRST202", message: "Could not find the function public.read_foundation_intake_approval",
      }), { status: 404 })));
      await expect(call()).resolves.toEqual({ ok: false, code: "INTAKE_APPROVAL_LINEAGE_UNAVAILABLE", status: 503 });
    });

    it("with the approval lineage off, makes no database call at all", async () => {
      configure();
      rollout.approval = false;
      rollout.triage = false;
      vi.stubGlobal("fetch", vi.fn());
      await expect(call()).resolves.toEqual({ ok: false, code: "INTAKE_APPROVAL_DISABLED", status: 404 });
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
