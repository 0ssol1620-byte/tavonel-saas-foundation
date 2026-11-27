import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  Audit #20 (WO-TRIAL-RELEASE-1): an upload refused at the compute hold, after its intake admission was
  reserved, releases that admission so it stops holding a slot of the free evaluation's three files.
  The database half (migration 20261127060000) is proven by supabase/tests/trial_intake_release_on_refusal.sql.
  Real intake-admission and compute-reservation modules; only PostgREST is a fake.
*/

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; body: Record<string, unknown> }>,
  computeError: null as string | null,
  admissionConfirmed: false,
  refuseStatus: 200,
  presign: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://project.supabase.co", serviceRoleKey: "s".repeat(40) }),
  supabaseAdminRequest: async (_config: unknown, path: string, init: RequestInit = {}) => {
    const name = path.replace(/^\/rest\/v1\/rpc\//, "");
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    mocks.calls.push({ name, body });
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    if (name === "reserve_foundation_intake_admission") {
      return Response.json({ documentId: body.p_document_id, objectKey: body.p_object_key, expiresAt: soon,
        idempotentReplay: mocks.admissionConfirmed, confirmed: mocks.admissionConfirmed });
    }
    if (name === "reserve_foundation_compute_v3") {
      if (mocks.computeError) return Response.json({ code: "P0001", message: mocks.computeError }, { status: 400 });
      return Response.json({ reservationId: body.p_document_id, documentId: body.p_document_id, state: "reserved",
        expiresAt: soon, reservedCredits: body.p_reserved_credits, maximumCredits: body.p_maximum_credits, billingSource: "trial" });
    }
    if (name === "refuse_foundation_intake_admission") {
      return mocks.refuseStatus === 200
        ? Response.json({ status: "refused", documentId: body.p_document_id, state: "rejected" })
        : Response.json({ message: "boom" }, { status: mocks.refuseStatus });
    }
    return Response.json({ code: "PGRST202" }, { status: 404 });
  },
}));
vi.mock("@/lib/developer-auth", () => ({
  authorizeFoundationRequest: async () => ({ ok: true, principal: {
    kind: "session", workspaceKey: "pilot-969dc192daa24119", userId: "969dc192-daa2-4119-a5d9-9a7621f171a1",
    authorizationRevision: 1, accessSource: "trial", workspaceRole: "owner",
  } }),
}));
vi.mock("@/lib/activation-policy", () => ({ activationPolicy: { customerIntake: { enabled: true, reason: "open" } } }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: async () => true }));
vi.mock("@/lib/r2-presign", async (importOriginal) => ({
  ...await importOriginal<typeof import("./r2-presign")>(),
  presignFoundationQuarantinePut: mocks.presign,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "bucket", accessKeyId: "key", secretAccessKey: "secret" }),
  headFoundationQuarantineObject: vi.fn(),
}));

import { POST as capabilityPost } from "../app/api/uploads/capability/route";
import { releaseFoundationIntake } from "./intake-admission";

function capability() {
  const text = JSON.stringify({ requestedBytes: 2048, originalFilename: "a.pdf", declaredMimeType: "application/pdf", estimatedPages: 3 });
  return capabilityPost(new Request("https://tavonel.com/api/uploads/capability", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(text.length), authorization: "Bearer session" },
    body: text,
  }));
}
const names = () => mocks.calls.map((c) => c.name);

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.computeError = null;
  mocks.admissionConfirmed = false;
  mocks.refuseStatus = 200;
  mocks.presign.mockReset().mockReturnValue({ ok: true, uploadUrl: "https://upload.invalid/signed" });
});

describe("a compute refusal releases the unconfirmed intake admission", () => {
  it("releases the admission it just reserved, with the compute code, and answers the refusal unchanged", async () => {
    mocks.computeError = "foundation_trial_page_limit_exceeded";
    const response = await capability();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "TRIAL_PAGE_LIMIT_EXCEEDED" });
    expect(names()).toEqual(["reserve_foundation_intake_admission", "reserve_foundation_compute_v3", "refuse_foundation_intake_admission"]);
    const admitted = mocks.calls[0].body;
    expect(mocks.calls[2].body).toEqual({
      p_workspace_key: admitted.p_workspace_key, p_document_id: admitted.p_document_id, p_reason_code: "TRIAL_PAGE_LIMIT_EXCEEDED",
    });
    expect(mocks.presign).not.toHaveBeenCalled();
  });

  it("a failed release keeps the same answer (the slot stays held until its window ends)", async () => {
    mocks.computeError = "foundation_trial_page_limit_exceeded";
    mocks.refuseStatus = 503;
    const response = await capability();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "TRIAL_PAGE_LIMIT_EXCEEDED" });
    expect(names()).toContain("refuse_foundation_intake_admission");
  });

  it("never releases an admission that is already confirmed (a real file)", async () => {
    mocks.computeError = "foundation_trial_page_limit_exceeded";
    mocks.admissionConfirmed = true;
    const response = await capability();
    expect(response.status).toBe(402);
    expect(names()).not.toContain("refuse_foundation_intake_admission");
  });

  it("does not release on success", async () => {
    const response = await capability();
    expect(response.status).toBe(200);
    expect(names()).toEqual(["reserve_foundation_intake_admission", "reserve_foundation_compute_v3"]);
  });

  it("sends a code outside the database's pattern as the generic one, and refuses ids it cannot have issued", async () => {
    mocks.calls.length = 0;
    await expect(releaseFoundationIntake({
      workspaceKey: "pilot-969dc192daa24119", documentId: "f07fe147-f52e-4fd0-8afc-79cd848b928d", reasonCode: "lower-case",
    })).resolves.toEqual({ ok: true });
    expect(mocks.calls[0].body.p_reason_code).toBe("COMPUTE_REFUSED");
    await expect(releaseFoundationIntake({ workspaceKey: "pilot/../other", documentId: "x y", reasonCode: "X_Y" }))
      .resolves.toEqual({ ok: false, code: "INTAKE_RELEASE_INVALID" });
    expect(mocks.calls).toHaveLength(1);
  });
});
