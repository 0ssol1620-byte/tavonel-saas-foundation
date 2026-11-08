import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  D1 stage 1 (PROGRAM-2026-11-04 §4.D, "단계 1: 25 MiB / 200쪽") at the capability route.

  Intake ships at stage 0 (`shared/intakeCeiling.ts` INTAKE_CEILING_STAGE, pinned by
  intake-ceiling-cross-tree.test.ts). This file swaps in the module's own stage-1 surface, the
  exact values a flip to 1 would export, and proves the route admits a source at the stage-1 byte
  ceiling and refuses one byte more with the typed 413, before any database call. The database is
  stubbed: the admission CHECKs still say 5 MiB (migration 0051), and raising them is a
  precondition of the flip, not of this file (docs/runbooks/RELEASE_ORDER.md, "W2-D").
*/

vi.mock("../../shared/intakeCeiling", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../shared/intakeCeiling")>();
  return { ...real, ...real.intakeCeilingFor(1), INTAKE_CEILING_STAGE: 1 };
});

const mocks = vi.hoisted(() => ({ calls: [] as string[], presign: vi.fn() }));

vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://project.supabase.co", serviceRoleKey: "s".repeat(40) }),
  supabaseAdminRequest: async (_config: unknown, path: string, init: RequestInit = {}) => {
    const name = path.replace(/^[/]rest[/]v1[/]rpc[/]/, "");
    mocks.calls.push(name);
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
    return Response.json({ code: "PGRST202", message: `Could not find the function public.${name}` }, { status: 404 });
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
}));
vi.mock("@/lib/self-service-trial", () => ({
  authorizeFoundationSessionProduct: async () => ({ ok: true, access: { source: "paid" } }),
  checkTrialCompileCapacity: async () => ({ ok: true, allowed: true }),
}));
vi.mock("@/lib/trial-source-risk", () => ({ assessTrialSourceReuse: async () => ({ ok: true }) }));
vi.mock("@/lib/funnel-events", () => ({ recordServerFunnel: vi.fn() }));

import { FOUNDATION_INTAKE_MAX_BYTES } from "./r2-presign";
import { MAX_DERIVED_JSON_BYTES } from "./r2-objects";
import { POST as capabilityPost } from "../app/api/uploads/capability/route";

const STAGE_1_BYTES = 25 * 1024 * 1024;

function capability(requestedBytes: number, estimatedPages?: number) {
  const text = JSON.stringify({
    originalFilename: "report.pdf", declaredMimeType: "application/pdf", requestedBytes,
    ...(estimatedPages === undefined ? {} : { estimatedPages }),
  });
  return capabilityPost(new Request("https://tavonel.com/api/uploads/capability", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(text.length), authorization: "Bearer session" },
    body: text,
  }));
}

beforeEach(() => {
  vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "");
  mocks.calls.length = 0;
  mocks.presign.mockReset().mockReturnValue({ ok: true, uploadUrl: "https://upload.invalid/signed", expiresAt: new Date(Date.now() + 300_000).toISOString() });
});

describe("intake at the D1 stage-1 ceiling", () => {
  it("derives every intake bound from the stage, not a literal", () => {
    expect(FOUNDATION_INTAKE_MAX_BYTES).toBe(STAGE_1_BYTES);
    // The compile's ocr.json read bound follows the page ceiling (#189): 24 MiB per 80 pages.
    expect(MAX_DERIVED_JSON_BYTES).toBe(60 * 1024 * 1024);
  });

  it("admits a source at exactly 25 MiB and 200 pages", async () => {
    const response = await capability(STAGE_1_BYTES, 200);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ code: "QUALIFIED", uploadUrl: "https://upload.invalid/signed" });
    expect(mocks.calls).toEqual(["reserve_foundation_intake_admission", "reserve_foundation_compute_v3"]);
  });

  it("refuses 25 MiB + 1 byte with SOURCE_EXCEEDS_PROCESSING_CEILING and the stage-1 numbers, before any database call", async () => {
    const response = await capability(STAGE_1_BYTES + 1, 1);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      code: "SOURCE_EXCEEDS_PROCESSING_CEILING",
      maxBytes: STAGE_1_BYTES,
      maxPages: 200,
      limit: "TAVONEL processes sources up to 25 MB and 200 pages.",
    });
    expect(mocks.calls).toEqual([]);
  });

  // Pages are not checked here at any stage: intake never decodes the document (intakeCeiling.ts
  // rule 2). The stage-1 page boundary (200 renders, 201 is refused 422) is proven where it is
  // enforced: cdr-cloudrun tests/test_measurement_limits.py IntakeCeilingStageTest, and the
  // reader and worker bounds in their own suites.
});
