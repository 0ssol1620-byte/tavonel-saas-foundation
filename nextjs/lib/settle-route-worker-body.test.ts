/**
 * The CDR worker's real settlement request, signed by the worker's own code, through the real
 * settle route, HMAC check and ledger client. Only the database answer is faked.
 *
 * WO-REL-2: a workspace outside TAVONEL_PAGE_METER_COHORT settles on v3 with the worker's
 * per-document `actualCredits` -- the call `main` makes for the same body -- and a cohort
 * workspace settles on v4 by its pages. The "accepts the worker body" cases are also run against
 * `git show origin/main:nextjs/app/api/internal/billing/settle/route.ts` (FAST-TRACK S4; receipt
 * under receipts/WO-REL-2/), which is why they assert nothing a pre-meter route cannot do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { adminRequest, settleProof } = vi.hoisted(() => ({ adminRequest: vi.fn(), settleProof: vi.fn() }));

vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://project.supabase.co", serviceRoleKey: "x".repeat(40) }),
  supabaseAdminRequest: adminRequest,
}));
vi.mock("@/lib/completed-read-proof", () => ({ settleCompletedRead: settleProof }));

import { POST } from "../app/api/internal/billing/settle/route";
import { dispatchComputeSettlement, type SettlementFacts } from "../../quarantine-sidecar/foundation-cdr-worker/src/settlement";

const URL_ = "https://tavonel-saas-foundation.vercel.app/api/internal/billing/settle";
const HMAC = "w".repeat(40);
const workspaceKey = "pilot-969dc192daa24119";
const otherWorkspace = "pilot-otherws01";
const documentId = "969dc192-daa2-4119-a5d9-9a7621f171a1";
const reservationId = "1b2f7a10-1111-4111-8111-111111111111";
const sourceSha256 = `sha256:${"a".repeat(64)}`;
const sourceKey = (ws: string) => `quarantine/${ws}/${documentId}/source`;

type Rpc = { path: string; body: Record<string, unknown> };
const rpcs = (): Rpc[] => adminRequest.mock.calls.map(([, path, init]) => ({
  path: String(path), body: init?.body ? JSON.parse(String(init.body)) : {},
}));

/** What the ledger answers: the v3 and v4 receipts their SQL builds, for the facts sent. */
function fakeLedger() {
  adminRequest.mockReset().mockImplementation(async (_config: unknown, path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (path === "/rest/v1/rpc/settle_foundation_compute_v3") {
      return Response.json({ status: "processed", reservationId, state: body.p_outcome,
        settledCredits: body.p_actual_credits, billingSource: "paid" });
    }
    if (path === "/rest/v1/rpc/settle_foundation_compute_v4") {
      const pages = body.p_pages as number | null;
      const review = body.p_outcome === "operator_review";
      return Response.json({ status: "processed", reservationId, state: body.p_outcome, billingSource: "paid",
        meteredPages: pages, meteredComplexPages: null, chargeBasis: review ? "no_usable_output" : "pages",
        chargeBasisReservationId: null, settledCredits: review ? 0 : (pages ?? 0) * 4 });
    }
    if (path.startsWith("/rest/v1/enterprise_workspaces")) {
      return Response.json([{ organization_id: "2b2f7a10-1111-4111-8111-111111111111" }]);
    }
    return new Response(null, { status: 204 });
  });
}

/** The worker's own dispatch, its fetch pointed at the route in this process. */
async function workerSends(ws: string, outcome: "settled" | "operator_review" | "released", actualCredits: 0 | 2,
  reasonCode: string, facts: SettlementFacts, workerEnv: Record<string, string> = {}) {
  const responses: Response[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await POST(new Request(String(input), init));
    responses.push(response.clone());
    return response;
  }) as typeof fetch;
  await dispatchComputeSettlement({ FOUNDATION_BILLING_SETTLEMENT_URL: URL_, FOUNDATION_BILLING_SETTLEMENT_HMAC: HMAC, ...workerEnv },
    sourceKey(ws), outcome, actualCredits, reasonCode, fetcher, undefined, undefined, facts);
  expect(responses).toHaveLength(1);
  return responses[0];
}

const completedRead = (ws: string) => {
  const sanitized = `sha256:${"b".repeat(64)}`;
  const prefix = `immutable/${ws}/${ws}/${documentId}/${sanitized.slice(7)}`;
  return {
    schemaVersion: "tavonel.completed_read.v1" as const, workspaceKey: ws, documentId,
    originalKey: sourceKey(ws), originalSha256: sourceSha256,
    sanitizedKey: `${prefix}/sanitized.pdf`, sanitizedSha256: sanitized,
    ocrKey: `${prefix}/ocr.json`, ocrSha256: `sha256:${"c".repeat(64)}`,
    observedPageCount: 3, readerRevision: `sha256:${"d".repeat(64)}`,
    readerBindingSha256: `sha256:${"e".repeat(64)}`,
  };
};

beforeEach(() => {
  vi.stubEnv("FOUNDATION_BILLING_SETTLEMENT_HMAC", HMAC);
  vi.stubEnv("FOUNDATION_COMPLETED_READ_ENABLED", "");
  vi.stubEnv("TAVONEL_PAGE_METER_COHORT", "");
  fakeLedger();
  settleProof.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("the new CDR worker body, outside the page-meter cohort", () => {
  it("accepts the worker body of a finished read and settles it per document", async () => {
    const response = await workerSends(workspaceKey, "settled", 2, "OCR_COMPLETED", { sourceSha256, meter: { pages: 7 } });
    expect(response.status).toBe(200);
    expect(rpcs()).toEqual([{ path: "/rest/v1/rpc/settle_foundation_compute_v3", body: {
      p_workspace_key: workspaceKey, p_document_id: documentId, p_outcome: "settled", p_actual_credits: 2,
      p_reason_code: "OCR_COMPLETED" } }]);
  });

  it("accepts the worker body of a failed read and settles it per document", async () => {
    const response = await workerSends(workspaceKey, "operator_review", 2, "OCR_RESPONSE_INVALID", { sourceSha256, meter: { pages: 5 } });
    expect(response.status).toBe(200);
    expect(rpcs()[0]).toEqual({ path: "/rest/v1/rpc/settle_foundation_compute_v3", body: expect.objectContaining({
      p_outcome: "operator_review", p_actual_credits: 2, p_reason_code: "OCR_RESPONSE_INVALID" }) });
  });

  it("accepts the worker body of a read it could not count (pages null)", async () => {
    const response = await workerSends(workspaceKey, "operator_review", 2, "PAGE_COUNT_UNKNOWN", { sourceSha256, meter: { pages: null } });
    expect(response.status).toBe(200);
    expect(rpcs()[0]).toEqual({ path: "/rest/v1/rpc/settle_foundation_compute_v3", body: expect.objectContaining({
      p_outcome: "operator_review", p_actual_credits: 2, p_reason_code: "PAGE_COUNT_UNKNOWN" }) });
  });

  it("accepts the worker body of a terminal refusal (released, no pages)", async () => {
    const response = await workerSends(workspaceKey, "released", 0, "CDR_PERMANENT_REJECT",
      { terminalReason: "quarantine source exceeds the 5 MiB Foundation CDR cap", failureClass: "PARSER_OOM" });
    expect(response.status).toBe(200);
    expect(rpcs()[0]).toEqual({ path: "/rest/v1/rpc/settle_foundation_compute_v3", body: expect.objectContaining({
      p_outcome: "released", p_actual_credits: 0 }) });
    expect(rpcs().some((call) => call.path === "/rest/v1/rpc/refuse_foundation_intake_admission")).toBe(true);
  });

  it("accepts the worker body that carries a completed-read proof (pages, sourceSha256, completedRead)", async () => {
    vi.stubEnv("FOUNDATION_COMPLETED_READ_ENABLED", "true");
    const proof = completedRead(workspaceKey);
    settleProof.mockResolvedValue({ ok: true, result: { status: "processed", reservationId, state: "settled",
      settledCredits: 2, billingSource: "paid", completedRead: proof } });
    const response = await workerSends(workspaceKey, "settled", 2, "OCR_COMPLETED",
      { sourceSha256, meter: { pages: 3 }, completedRead: proof }, { FOUNDATION_COMPLETED_READ_ENABLED: "true" });
    expect(response.status).toBe(200);
    expect(settleProof).toHaveBeenCalledExactlyOnceWith(proof);
    expect(rpcs()).toHaveLength(0);
  });
});

describe("the new CDR worker body, inside the page-meter cohort", () => {
  it("settles a cohort workspace's finished read by its pages, and leaves the others per document", async () => {
    vi.stubEnv("TAVONEL_PAGE_METER_COHORT", `${workspaceKey}`);
    const metered = await workerSends(workspaceKey, "settled", 2, "OCR_COMPLETED", { sourceSha256, meter: { pages: 7 } });
    expect(metered.status).toBe(200);
    await expect(metered.json()).resolves.toMatchObject({ result: { settledCredits: 28, chargeBasis: "pages" } });
    expect(rpcs()).toEqual([{ path: "/rest/v1/rpc/settle_foundation_compute_v4", body: {
      p_workspace_key: workspaceKey, p_document_id: documentId, p_outcome: "settled", p_pages: 7,
      p_complex_pages: null, p_source_sha256: sourceSha256, p_reason_code: "OCR_COMPLETED" } }]);

    fakeLedger();
    const other = await workerSends(otherWorkspace, "settled", 2, "OCR_COMPLETED", { sourceSha256, meter: { pages: 7 } });
    expect(other.status).toBe(200);
    expect(rpcs()[0]?.path).toBe("/rest/v1/rpc/settle_foundation_compute_v3");
  });

  it("settles a cohort workspace's uncounted read as no usable output", async () => {
    vi.stubEnv("TAVONEL_PAGE_METER_COHORT", "*");
    const response = await workerSends(workspaceKey, "operator_review", 2, "PAGE_COUNT_UNKNOWN", { sourceSha256, meter: { pages: null } });
    expect(response.status).toBe(200);
    expect(rpcs()[0]).toEqual({ path: "/rest/v1/rpc/settle_foundation_compute_v4", body: expect.objectContaining({
      p_outcome: "operator_review", p_pages: null }) });
  });
});
