import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authorize,
  enqueueSingle,
  enqueueCorpus,
  listJobs,
  checkSourceAccess,
  canAdmit,
  readSourceScope,
  recordFunnel,
  checkTrialCapacity,
  assertIntakeSet,
} = vi.hoisted(() => ({
  authorize: vi.fn(),
  enqueueSingle: vi.fn(),
  enqueueCorpus: vi.fn(),
  listJobs: vi.fn(),
  checkSourceAccess: vi.fn(),
  canAdmit: vi.fn(),
  readSourceScope: vi.fn(),
  readBoundedJson: vi.fn(),
  recordFunnel: vi.fn(),
  checkTrialCapacity: vi.fn(),
  assertIntakeSet: vi.fn(),
}));

vi.mock("@/lib/compile-limits", () => ({ COMPILE_MAX_DOCUMENTS: 8 }));
vi.mock("@/lib/compile-job-store", () => ({
  compileIdempotencyKey: () => "idempotency-test-key",
  enqueueCompileJob: enqueueSingle,
  enqueueCorpusCompile: enqueueCorpus,
  listWorkspaceCompileJobs: listJobs,
}));
vi.mock("@/lib/corpus-batching", () => ({
  CORPUS_MAX_DOCUMENTS: 128,
  judgeCorpusSet: () => ({ ok: true }),
  needsCorpusCompile: (count: number) => count > 1,
}));
vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: authorize }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccessForViewer: checkSourceAccess }));
vi.mock("@/lib/connector-oauth", () => ({ googleDriveViewerLinkEnabled: () => false }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: canAdmit }));
vi.mock("@/lib/customer-source-scope", () => ({ readCustomerSourceScope: readSourceScope }));
vi.mock("@/lib/enterprise-http", () => ({
  readBoundedJson: async (request: Request) => ({ ok: true, value: await request.json() }),
}));
vi.mock("@/lib/funnel-events", () => ({ recordServerFunnel: recordFunnel }));
vi.mock("@/lib/immutable-keys", () => ({
  DOCUMENT_ID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
}));
vi.mock("@/lib/self-service-trial", () => ({ checkTrialCompileCapacity: checkTrialCapacity }));
vi.mock("@/lib/compute-reservation", () => ({ assertFoundationIntakeCompileSet: assertIntakeSet }));

import { POST } from "./route";

const workspaceKey = "pilot-969dc192daa24119";
const documentIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];

function authPrincipal(kind: "session" | "api-key") {
  return {
    kind,
    workspaceKey,
    userId: kind === "session" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    authorizationRevision: kind === "session" ? 17 : 29,
    accessSource: "paid",
  };
}

function request(ids: string[], kind: "session" | "api-key") {
  const body = JSON.stringify({
    documentIds: ids,
    // Identity and epoch are server-derived. A caller-supplied value must not replace them.
    createdByUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    authorizationRevision: 999,
  });
  return new Request("https://tavonel.test/api/compile-jobs", {
    method: "POST",
    headers: {
      authorization: kind === "session" ? "Bearer session-token" : "Bearer tvnl_live_test-key",
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(body).length),
    },
    body,
  });
}

beforeEach(() => {
  vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "");
  authorize.mockReset();
  enqueueSingle.mockReset().mockResolvedValue({
    ok: true, value: { jobId: "cjob-00000000000000000000000000000001", state: "queued", created: true },
  });
  enqueueCorpus.mockReset().mockResolvedValue({
    ok: true,
    value: {
      corpusId: "ccorpus-00000000000000000000000000000001",
      batchCount: 1,
      incompleteReason: null,
      parts: [{ created: true }],
    },
  });
  listJobs.mockReset().mockResolvedValue({ ok: true, value: [] });
  checkSourceAccess.mockReset().mockResolvedValue({ ok: true });
  canAdmit.mockReset().mockResolvedValue(true);
  readSourceScope.mockReset().mockResolvedValue({ ok: true, scope: "direct_upload" });
  recordFunnel.mockReset();
  checkTrialCapacity.mockReset().mockResolvedValue({ ok: true, allowed: true });
  assertIntakeSet.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("compile job enqueue actor binding", () => {
  for (const kind of ["session", "api-key"] as const) {
    const principal = authPrincipal(kind);

    it(`binds the ${kind} owner ID and revision on the single-job path`, async () => {
      authorize.mockResolvedValueOnce({ ok: true, principal });
      const response = await POST(request([documentIds[0]], kind));

      expect(response.status).toBe(202);
      expect(checkSourceAccess).toHaveBeenCalledWith(workspaceKey, [documentIds[0]], principal.userId);
      expect(enqueueSingle).toHaveBeenCalledWith(expect.objectContaining({
        workspaceKey,
        createdByUserId: principal.userId,
        authorizationRevision: principal.authorizationRevision,
        documentIds: [documentIds[0]],
      }));
      expect(enqueueCorpus).not.toHaveBeenCalled();
    });

    it(`binds the ${kind} owner ID and revision on the corpus path`, async () => {
      authorize.mockResolvedValueOnce({ ok: true, principal });
      const response = await POST(request(documentIds, kind));

      expect(response.status).toBe(202);
      expect(checkSourceAccess).toHaveBeenCalledWith(workspaceKey, documentIds, principal.userId);
      expect(enqueueCorpus).toHaveBeenCalledWith(expect.objectContaining({
        workspaceKey,
        createdByUserId: principal.userId,
        authorizationRevision: principal.authorizationRevision,
        documentIds,
      }));
      expect(enqueueSingle).not.toHaveBeenCalled();
    });
  }
});
