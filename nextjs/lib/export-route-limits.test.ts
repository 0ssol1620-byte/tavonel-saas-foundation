import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Blueprint 2026-09-08 §32, S-22: the signed export, bounded.

  A signed export reads the candidate package, builds a zip of the whole thing and signs it. None
  of that was bounded: no `maxDuration` on the route, and no cap on how many builds one workspace
  could have running at once. Two concurrent is a deliberate number rather than a round one --
  an export is a person clicking download, and a workspace that needs a third simultaneous one is
  a script, which is the case this refuses.

  The slot is taken after the cheap refusals, and the second test is what proves it: a malformed
  collection id must not spend a slot, or a client can lock a workspace out of exports with
  requests that were never going to build anything.
*/

const { authorize, signerEnv, loadCandidate } = vi.hoisted(() => ({
  authorize: vi.fn(),
  signerEnv: vi.fn(),
  loadCandidate: vi.fn(),
}));

vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: authorize,
}));
vi.mock("@/lib/r2-synthetic-canary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-synthetic-canary")>()),
  readR2SignerEnv: signerEnv,
}));
vi.mock("@/lib/collection-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./collection-storage")>()),
  loadPreferredCollectionCandidate: loadCandidate,
}));

import { GET as download, maxDuration } from "../app/api/collections/[id]/download/route";
import { WORKSPACE_EXPORT_CONCURRENCY, resetWorkspaceCostGuard } from "./workspace-cost-guard";

const WORKSPACE = "pilot-exportcost";
const COLLECTION = `collection-${"e".repeat(32)}`;

function request(id = COLLECTION) {
  return new Request(`https://tavonel.test/api/collections/${id}/download`, {
    headers: { authorization: "Bearer tvnl_live_probe" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkspaceCostGuard();
  authorize.mockResolvedValue({
    ok: true,
    principal: { kind: "api-key", workspaceKey: WORKSPACE, userId: "user-1", scopes: [] },
  });
  signerEnv.mockReturnValue({ accountId: "acct", accessKeyId: "id", secretAccessKey: "secret", bucket: "b" });
  // Absent rather than invalid: this suite is about the guard, and NOT_FOUND is the cheapest
  // completed path through it.
  loadCandidate.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
});

afterEach(() => {
  resetWorkspaceCostGuard();
});

describe("concurrent exports per workspace", () => {
  it("refuses the export past the cap instead of building it", async () => {
    let unblock = () => {};
    const parked = new Promise<void>((resolve) => { unblock = () => resolve(); });
    loadCandidate.mockImplementation(async () => {
      await parked;
      return { ok: false, code: "NOT_FOUND" };
    });

    const inFlight = Array.from({ length: WORKSPACE_EXPORT_CONCURRENCY }, () =>
      download(request(), { params: Promise.resolve({ id: COLLECTION }) }));
    await new Promise((resolve) => setImmediate(resolve));

    const overLimit = await download(request(), { params: Promise.resolve({ id: COLLECTION }) });
    expect(overLimit.status).toBe(429);
    expect(await overLimit.json()).toEqual({
      code: "WORKSPACE_CONCURRENCY_LIMIT",
      concurrencyLimit: WORKSPACE_EXPORT_CONCURRENCY,
    });
    expect(overLimit.headers.get("retry-after")).toBe("10");

    unblock();
    await Promise.all(inFlight);
  });

  it("spends no slot on a request that is refused before any work starts", async () => {
    for (let index = 0; index < WORKSPACE_EXPORT_CONCURRENCY + 3; index += 1) {
      const response = await download(request("not-a-collection-id"), {
        params: Promise.resolve({ id: "not-a-collection-id" }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: "COLLECTION_ID_INVALID" });
    }
    // The cap is untouched: a real export still runs.
    const real = await download(request(), { params: Promise.resolve({ id: COLLECTION }) });
    expect(real.status).toBe(404);
  });

  it("frees the slot when the build finishes", async () => {
    for (let index = 0; index <= WORKSPACE_EXPORT_CONCURRENCY; index += 1) {
      expect((await download(request(), { params: Promise.resolve({ id: COLLECTION }) })).status).toBe(404);
    }
    expect(loadCandidate).toHaveBeenCalledTimes(WORKSPACE_EXPORT_CONCURRENCY + 1);
  });

  it("frees the slot when the build throws", async () => {
    loadCandidate.mockRejectedValueOnce(new Error("storage exploded"));
    await expect(download(request(), { params: Promise.resolve({ id: COLLECTION }) }))
      .rejects.toThrow("storage exploded");
    for (let index = 0; index < WORKSPACE_EXPORT_CONCURRENCY; index += 1) {
      expect((await download(request(), { params: Promise.resolve({ id: COLLECTION }) })).status).toBe(404);
    }
  });

  it("counts slots per workspace", async () => {
    let unblock = () => {};
    const parked = new Promise<void>((resolve) => { unblock = () => resolve(); });
    loadCandidate.mockImplementation(async () => {
      await parked;
      return { ok: false, code: "NOT_FOUND" };
    });
    const inFlight = Array.from({ length: WORKSPACE_EXPORT_CONCURRENCY }, () =>
      download(request(), { params: Promise.resolve({ id: COLLECTION }) }));
    await new Promise((resolve) => setImmediate(resolve));

    authorize.mockResolvedValue({
      ok: true,
      principal: { kind: "api-key", workspaceKey: "pilot-elsewhere", userId: "user-2", scopes: [] },
    });
    const other = download(request(), { params: Promise.resolve({ id: COLLECTION }) });
    await new Promise((resolve) => setImmediate(resolve));
    unblock();
    expect((await other).status).toBe(404);
    await Promise.all(inFlight);
  });
});

describe("the platform half of the bound", () => {
  it("declares a maxDuration, so a zip build cannot run past the slot deadline unseen", () => {
    expect(maxDuration).toBe(60);
  });
});
