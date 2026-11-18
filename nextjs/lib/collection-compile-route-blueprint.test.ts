import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-C-C1: the synchronous compile route's `blueprint` field, through the real route handler.
  Everything the route calls is replaced except `readBlueprintChoice`, which is the code under test.
*/
const run = vi.fn();
vi.mock("@/lib/collection-compile-run", () => ({ runCollectionCompile: (...args: unknown[]) => run(...args) }));
vi.mock("@/lib/developer-auth", () => ({
  authorizeFoundationRequest: async () => ({
    ok: true,
    principal: { workspaceKey: "pilot-acme01", userId: "00000000-0000-4000-8000-000000000001", accessSource: "paid", authorizationRevision: 1 },
  }),
}));
vi.mock("@/lib/compute-reservation", () => ({ assertFoundationIntakeCompileSet: async () => ({ ok: true }) }));
vi.mock("@/lib/funnel-events", () => ({ recordServerFunnel: () => undefined }));

const { POST } = await import("../app/api/collections/compile/route");

const DOCUMENT = "f07fe147-f52e-4fd0-8afc-79cd848b928d";

function post(body: unknown) {
  const text = JSON.stringify(body);
  return new Request("https://tavonel.test/api/collections/compile", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(text.length) },
    body: text,
  });
}

beforeEach(() => {
  run.mockReset().mockResolvedValue({ ok: false, status: 503, code: "STOP_HERE", payload: {} });
});

describe("compile route: blueprint choice", () => {
  it.each(["creative-works", "team-workspace", "Legal-Contracts", "", 7, null, ["legal-contracts"]])(
    "refuses %j before any work starts, and never replaces it",
    async (blueprint) => {
      const response = await POST(post({ documentIds: [DOCUMENT], blueprint }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: "BLUEPRINT_UNSUPPORTED" });
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("passes one of the seven ids to the compile as the requested blueprint", async () => {
    await POST(post({ documentIds: [DOCUMENT], blueprint: "legal-contracts" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[6]).toBe("legal-contracts");
  });

  it.each([undefined, "generic"])("sends no blueprint for %j", async (blueprint) => {
    await POST(post({ documentIds: [DOCUMENT], ...(blueprint === undefined ? {} : { blueprint }) }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[6]).toBeUndefined();
  });
});
