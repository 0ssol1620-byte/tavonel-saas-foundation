import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, pilotAccess, membership, load, record } = vi.hoisted(() => ({
  getUser: vi.fn(),
  pilotAccess: vi.fn(),
  membership: vi.fn(),
  load: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/foundation-pilot", () => ({ getRequestUser: getUser, foundationPilotAccess: pilotAccess }));
vi.mock("@/lib/workspace-membership", () => ({ getWorkspaceMembership: membership }));
vi.mock("@/lib/processing-terms-acceptance", async (importOriginal) => ({
  ...await importOriginal<typeof import("./processing-terms-acceptance")>(),
  loadPublishedProcessingTerms: load,
  recordProcessingTermsAcceptance: record,
}));

import { GET, POST } from "../app/api/access/processing-terms/route";

const USER = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "pilot-1111111111114111";
const manifest = {
  version: "2026-09-30",
  terms: { path: "/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md", sha256: `sha256:${"a".repeat(64)}` },
  processing: { path: "/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md", sha256: `sha256:${"b".repeat(64)}` },
};
const offer = { accepted: true, ...manifest, scope: "direct_upload" };
const receipt = {
  acceptanceId: "22222222-2222-4222-8222-222222222222", workspaceKey: WORKSPACE, userId: USER,
  actorRole: "owner", authorizationRevision: 1, scope: "direct_upload", termsVersion: manifest.version,
  terms: manifest.terms, processing: manifest.processing, acceptedAt: "2026-09-30T01:00:00.000Z", idempotentReplay: false,
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request("https://tavonel.test/api/access/processing-terms", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

describe("processing terms acceptance route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ id: USER });
    pilotAccess.mockReturnValue({ membership: { workspaceId: WORKSPACE } });
    load.mockResolvedValue({ ok: true, manifest });
    membership.mockResolvedValue({ ok: true, membership: { role: "owner", state: "active" } });
    record.mockResolvedValue({ ok: true, receipt });
  });

  it("GET offers only the verified manifest", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ...manifest, scopes: ["direct_upload", "connector"] });
  });

  it("GET is unavailable when the published documents are not verifiable", async () => {
    load.mockResolvedValue({ ok: false, code: "PROCESSING_TERMS_UNAVAILABLE", status: 503 });
    expect((await GET()).status).toBe(503);
  });

  it("records the owner's acceptance with server-derived authority and grants nothing else", async () => {
    const response = await post(offer);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      code: "PROCESSING_TERMS_ACCEPTED",
      receipt: {
        acceptanceId: receipt.acceptanceId, scope: "direct_upload", termsVersion: "2026-09-30",
        terms: manifest.terms, processing: manifest.processing, acceptedAt: receipt.acceptedAt, idempotentReplay: false,
      },
    });
    expect(body).not.toHaveProperty("access");
    expect(membership).toHaveBeenCalledWith(WORKSPACE, USER);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ workspaceKey: WORKSPACE, userId: USER, scope: "direct_upload", manifest }));
  });

  it("answers an exact replay with 200", async () => {
    record.mockResolvedValue({ ok: true, receipt: { ...receipt, idempotentReplay: true } });
    expect((await post(offer)).status).toBe(200);
  });

  it("requires a validated session before reading the body or the store", async () => {
    getUser.mockResolvedValue(null);
    expect((await post(offer)).status).toBe(401);
    expect(load).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("requires workspace access", async () => {
    pilotAccess.mockReturnValue(null);
    expect((await post(offer)).status).toBe(403);
    expect(record).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-owner member", { ok: true, membership: { role: "admin", state: "active" } }],
    ["a revoked owner", { ok: true, membership: { role: "owner", state: "revoked" } }],
    ["no membership", { ok: true, membership: null }],
  ])("refuses %s", async (_, found) => {
    membership.mockResolvedValue(found);
    const response = await post(offer);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "WORKSPACE_OWNER_REQUIRED" });
    expect(record).not.toHaveBeenCalled();
  });

  it("fails closed when membership cannot be read", async () => {
    membership.mockResolvedValue({ ok: false, code: "WORKSPACE_MEMBERSHIP_READ_FAILED", status: 503 });
    expect((await post(offer)).status).toBe(503);
    expect(record).not.toHaveBeenCalled();
  });

  it("rejects requested authority identifiers instead of using them", async () => {
    const response = await post({ ...offer, workspaceId: "pilot-attacker" });
    expect(response.status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });

  it("requires explicit agreement to the exact offered documents", async () => {
    expect((await post({ ...offer, accepted: false })).status).toBe(400);
    expect((await post({ ...offer, processing: { ...manifest.processing, sha256: `sha256:${"c".repeat(64)}` } })).status).toBe(409);
    expect((await post({ ...offer, version: "2026-09-23" })).status).toBe(409);
    expect(record).not.toHaveBeenCalled();
  });

  it("never accepts while the published documents are unavailable", async () => {
    load.mockResolvedValue({ ok: false, code: "PROCESSING_TERMS_UNAVAILABLE", status: 503 });
    expect((await post(offer)).status).toBe(503);
    expect(record).not.toHaveBeenCalled();
  });

  it("bounds the body and requires JSON", async () => {
    expect((await post(JSON.stringify({ ...offer, pad: "x".repeat(4_000) }))).status).toBe(413);
    expect((await post("{", {})).status).toBe(400);
    expect((await post(offer, { "content-type": "text/plain" })).status).toBe(415);
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses a browser cross-site post", async () => {
    expect((await post(offer, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("surfaces the database owner re-check", async () => {
    record.mockResolvedValue({ ok: false, code: "WORKSPACE_OWNER_REQUIRED", status: 403 });
    expect((await post(offer)).status).toBe(403);
  });
});
