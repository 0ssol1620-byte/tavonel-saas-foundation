import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  The whole-set approval lineage is off by default (lib/intake-approval-rollout.ts), and with it off
  every upload, capability and compile path must behave as main dbe22b1e does against today's
  production schema. The rollout switches are NOT mocked here: these are the shipped values.

  The database below is the production schema the reviewer read on 2026-10-15: it has main's four
  intake functions and nothing from migrations 20261003120000..20261007100000 or the triage draft.
  Any other function answers PostgREST's PGRST202, so a call this file does not expect also fails
  the request it belongs to, not only the name assertion.
*/

const PRODUCTION_FUNCTIONS = new Set([
  "reserve_foundation_intake_admission",
  "reserve_foundation_compute_v3",
  "confirm_foundation_intake_admission",
  "settle_foundation_compute_v3",
]);

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  head: vi.fn(),
  presign: vi.fn(),
  enqueueSingle: vi.fn(),
  runCompile: vi.fn(),
}));

function rpcName(path: string) {
  return path.replace(/^[/]rest[/]v1[/]rpc[/]/, "");
}

vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://project.supabase.co", serviceRoleKey: "s".repeat(40) }),
  supabaseAdminRequest: async (_config: unknown, path: string, init: RequestInit = {}) => {
    const name = rpcName(path);
    mocks.calls.push(name);
    if (!PRODUCTION_FUNCTIONS.has(name)) {
      return Response.json({ code: "PGRST202", message: `Could not find the function public.${name}` }, { status: 404 });
    }
    const p = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    if (name === "reserve_foundation_intake_admission") {
      return Response.json({ documentId: p.p_document_id, objectKey: p.p_object_key, expiresAt: soon, idempotentReplay: false, confirmed: false });
    }
    if (name === "reserve_foundation_compute_v3") {
      return Response.json({
        reservationId: p.p_document_id, documentId: p.p_document_id, state: "reserved", expiresAt: soon,
        reservedCredits: p.p_reserved_credits, maximumCredits: p.p_maximum_credits, billingSource: "paid",
      });
    }
    if (name === "confirm_foundation_intake_admission") {
      return Response.json({ documentId: p.p_document_id, status: "confirmed", confirmedAt: new Date().toISOString() });
    }
    return Response.json({
      reservationId: p.p_document_id, status: "processed", state: p.p_outcome, settledCredits: p.p_actual_credits, billingSource: "paid",
    });
  },
}));
vi.mock("@/lib/developer-auth", () => ({
  authorizeFoundationRequest: async () => ({ ok: true, principal: {
    kind: "session", workspaceKey: "pilot-969dc192daa24119", userId: "969dc192-daa2-4119-a5d9-9a7621f171a1",
    authorizationRevision: 1, accessSource: "paid",
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
  headFoundationQuarantineObject: mocks.head,
  headFoundationQuarantineSignature: async () => ({ ok: true, exists: true, bytes: new TextEncoder().encode("%PDF-1.4\n%fixture\n") }),
}));
vi.mock("@/lib/self-service-trial", () => ({
  authorizeFoundationSessionProduct: async () => ({ ok: true, access: { source: "paid" } }),
  checkTrialCompileCapacity: async () => ({ ok: true, allowed: true }),
}));
vi.mock("@/lib/trial-source-risk", () => ({ assessTrialSourceReuse: async () => ({ ok: true }) }));
vi.mock("@/lib/compile-job-store", () => ({
  compileIdempotencyKey: () => "idempotency-test-key",
  enqueueCompileJob: mocks.enqueueSingle,
  enqueueCorpusCompile: vi.fn(),
  listWorkspaceCompileJobs: vi.fn(),
}));
vi.mock("@/lib/connector-source-access", () => ({
  checkConnectorSourceAccess: async () => ({ ok: true }),
  checkConnectorSourceAccessForViewer: async () => ({ ok: true }),
}));
vi.mock("@/lib/funnel-events", () => ({ recordServerFunnel: vi.fn() }));
vi.mock("@/lib/collection-compile-run", () => ({ runCollectionCompile: mocks.runCompile }));

import { INTAKE_APPROVAL_ROLLOUT_ENABLED } from "./intake-approval-rollout";
import { INTAKE_TRIAGE_ROLLOUT_ENABLED } from "./intake-triage-rollout";
import { assertFoundationIntakeCompileSet, readFoundationIntakeApproval } from "./compute-reservation";
import { POST as capabilityPost } from "../app/api/uploads/capability/route";
import { POST as confirmPost } from "../app/api/uploads/confirm/route";
import { POST as releasePost } from "../app/api/uploads/release/route";
import { GET as approvalGet, POST as approvalPost } from "../app/api/uploads/approval/route";
import { POST as approvalCancelPost } from "../app/api/uploads/approval/cancel/route";
import { POST as v1CapabilityPost } from "../app/api/v1/uploads/capability/route";
import { POST as stagePost } from "../app/api/v1/uploads/triage/stage/route";
import { POST as compileJobsPost } from "../app/api/compile-jobs/route";
import { POST as collectionsCompilePost } from "../app/api/collections/compile/route";

const documentId = "f07fe147-f52e-4fd0-8afc-79cd848b928d";
const otherId = "11111111-1111-4111-8111-111111111111";

function json(url: string, body: unknown) {
  const text = JSON.stringify(body);
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(text.length), authorization: "Bearer session" },
    body: text,
  });
}

beforeEach(() => {
  vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "");
  mocks.calls.length = 0;
  mocks.head.mockReset().mockResolvedValue({ ok: true, exists: true, sizeBytes: 2048, contentType: "application/pdf", etag: "etag" });
  mocks.presign.mockReset().mockReturnValue({ ok: true, uploadUrl: "https://upload.invalid/signed", expiresAt: new Date(Date.now() + 300_000).toISOString() });
  mocks.enqueueSingle.mockReset().mockResolvedValue({
    ok: true, value: { jobId: "cjob-00000000000000000000000000000001", state: "queued", created: true },
  });
  mocks.runCompile.mockReset().mockResolvedValue({ ok: true, payload: { coreExecution: { status: "ready" } } });
});

describe("intake approval lineage off (the production default)", () => {
  it("ships off, and triage off with it", () => {
    expect(INTAKE_APPROVAL_ROLLOUT_ENABLED).toBe(false);
    expect(INTAKE_TRIAGE_ROLLOUT_ENABLED).toBe(false);
  });

  it("issues a capability through main's admission and per-file compute reservation only", async () => {
    for (const post of [capabilityPost, v1CapabilityPost]) {
      mocks.calls.length = 0;
      const response = await post(json("https://tavonel.com/api/uploads/capability", {
        originalFilename: "report.pdf", declaredMimeType: "application/pdf", requestedBytes: 2048, estimatedPages: 2,
      }));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ code: "QUALIFIED", uploadUrl: "https://upload.invalid/signed" });
      expect(mocks.calls).toEqual(["reserve_foundation_intake_admission", "reserve_foundation_compute_v3"]);
    }
  });

  it("refuses an over-ceiling source with the code and the limit, before any database call", async () => {
    const response = await capabilityPost(json("https://tavonel.com/api/uploads/capability", {
      originalFilename: "report.pdf", declaredMimeType: "application/pdf", requestedBytes: 10 ** 12,
    }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "SOURCE_EXCEEDS_PROCESSING_CEILING", limit: expect.any(String) });
    expect(mocks.calls).toEqual([]);
  });

  it("confirms through confirm_foundation_intake_admission without an approval identity", async () => {
    const response = await confirmPost(json("https://tavonel.com/api/uploads/confirm", {
      documentId, sourceSha256: `sha256:${"a".repeat(64)}`,
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ code: "UPLOAD_CONFIRMED", result: { documentId, status: "confirmed" } });
    expect(mocks.calls).toEqual(["confirm_foundation_intake_admission"]);
  });

  it("releases a failed transfer through settle_foundation_compute_v3, never a 428", async () => {
    mocks.head.mockResolvedValue({ ok: true, exists: false });
    const response = await releasePost(json("https://tavonel.com/api/uploads/release", { documentId }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ code: "UPLOAD_CREDITS_RELEASED" });
    expect(mocks.calls).toEqual(["settle_foundation_compute_v3"]);
  });

  it("answers the approval routes as disabled and the triage check with the off signal", async () => {
    const approval = await approvalPost(json("https://tavonel.com/api/uploads/approval", { attemptKey: "attempt_0123456789abcdef" }));
    expect(approval.status).toBe(404);
    await expect(approval.json()).resolves.toEqual({ code: "INTAKE_APPROVAL_DISABLED" });
    const status = await approvalGet(new Request("https://tavonel.com/api/uploads/approval?attemptKey=attempt_0123456789abcdef"));
    expect(status.status).toBe(404);
    const cancel = await approvalCancelPost(json("https://tavonel.com/api/uploads/approval/cancel", {}));
    expect(cancel.status).toBe(404);
    const stage = await stagePost(json("https://tavonel.com/api/v1/uploads/triage/stage", {}));
    expect(stage.status).toBe(404);
    await expect(stage.json()).resolves.toEqual({ code: "INTAKE_TRIAGE_DISABLED", intakeApproval: "disabled" });
    expect(mocks.calls).toEqual([]);
  });

  it("reads no approval and asserts no compile set", async () => {
    await expect(readFoundationIntakeApproval({
      workspaceKey: "pilot-969dc192daa24119", userId: "969dc192-daa2-4119-a5d9-9a7621f171a1", attemptKey: "attempt_0123456789abcdef",
    })).resolves.toEqual({ ok: false, code: "INTAKE_APPROVAL_DISABLED", status: 404 });
    await expect(assertFoundationIntakeCompileSet({
      workspaceKey: "pilot-969dc192daa24119", userId: "969dc192-daa2-4119-a5d9-9a7621f171a1", documentIds: [documentId],
    })).resolves.toEqual({ ok: true });
    expect(mocks.calls).toEqual([]);
  });

  it("enqueues a compile job and runs a collection compile without assert_foundation_intake_compile_set", async () => {
    const queued = await compileJobsPost(json("https://tavonel.com/api/compile-jobs", { documentIds: [documentId] }));
    expect(queued.status).toBe(202);
    expect(mocks.enqueueSingle).toHaveBeenCalledTimes(1);
    const compiled = await collectionsCompilePost(json("https://tavonel.com/api/collections/compile", { documentIds: [documentId, otherId] }));
    expect(compiled.status).toBe(200);
    expect(mocks.runCompile).toHaveBeenCalledTimes(1);
    expect(mocks.calls).not.toContain("assert_foundation_intake_compile_set");
    expect(mocks.calls).toEqual([]);
  });
});
