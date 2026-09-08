import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { config, rpc } = vi.hoisted(() => ({ config: vi.fn(), rpc: vi.fn() }));
vi.mock("./supabase-admin", () => ({ readSupabaseAdminConfig: config, supabaseAdminRequest: rpc }));
import { consumeDurableContactLimit } from "./contact-durable-guard";

const request = () => new Request("https://tavonel.com/api/contact", { headers: { "x-forwarded-for": "192.0.2.15" } });
beforeEach(() => {
  config.mockReset(); rpc.mockReset();
  config.mockReturnValue({ url: "https://db.example.test", serviceRoleKey: "test-only-".repeat(5) });
});
afterEach(() => vi.unstubAllEnvs());
describe("durable contact admission", () => {
  it.each([[true, "allowed"], [false, "limited"]] as const)("respects atomic verdict %s", async (value, expected) => {
    rpc.mockResolvedValue(new Response(JSON.stringify(value)));
    expect(await consumeDurableContactLimit(request(), "user@example.test")).toBe(expected);
  });
  it("persists only stable, domain-separated digests", async () => {
    rpc.mockImplementation(async () => new Response("true"));
    await consumeDurableContactLimit(request(), "user@EXAMPLE.test");
    await consumeDurableContactLimit(request(), "another@example.test");
    const first = JSON.parse(rpc.mock.calls[0][2].body);
    const next = JSON.parse(rpc.mock.calls[1][2].body);
    expect(first).toEqual(next);
    expect(first.p_ip_key).toMatch(/^[a-f0-9]{64}$/);
    expect(first.p_domain_key).toMatch(/^[a-f0-9]{64}$/);
    expect(first.p_ip_key).not.toBe(first.p_domain_key);
    expect(JSON.stringify(first)).not.toContain("192.0.2.15");
    expect(JSON.stringify(first)).not.toContain("example.test");
  });
  it("requires configuration, never silently allowing requests", async () => {
    config.mockReturnValue(null);
    expect(await consumeDurableContactLimit(request(), "user@example.test")).toBe("unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([null, {}, "true", 1])("rejects malformed success response %j", async value => {
    rpc.mockResolvedValue(new Response(JSON.stringify(value)));
    expect(await consumeDurableContactLimit(request(), "user@example.test")).toBe("unavailable");
  });
  it("refuses a missing migration or unavailable database", async () => {
    rpc.mockResolvedValueOnce(new Response("missing", { status: 404 }));
    expect(await consumeDurableContactLimit(request(), "user@example.test")).toBe("unavailable");
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await consumeDurableContactLimit(request(), "user@example.test")).toBe("unavailable");
  });
  it("bounds header input before hashing or querying", async () => {
    const malicious = new Request("https://tavonel.com/api/contact", { headers: { "x-forwarded-for": "x".repeat(257) } });
    expect(await consumeDurableContactLimit(malicious, "user@example.test")).toBe("unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
});
