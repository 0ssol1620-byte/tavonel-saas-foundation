import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { config, rpc } = vi.hoisted(() => ({ config: vi.fn(), rpc: vi.fn() }));
vi.mock("./supabase-admin", () => ({ readSupabaseAdminConfig: config, supabaseAdminRequest: rpc }));
import { acquireWorkspaceOperation, resetLocalWorkspaceOperationsForTest } from "./workspace-operation-guard";

const request = (key = "request-0001", identity = "session:one:world:v1", body = "which source changed?") => ({ key, identity, body });
const answer = { status: 200, body: { code: "GROUNDED_ANSWER", excerpt: "private evidence" } };
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("TAVONEL_DURABLE_WORKSPACE_GUARDS", "0");
  config.mockReset(); rpc.mockReset(); resetLocalWorkspaceOperationsForTest();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("single-flight operation lifecycle", () => {
  it("permits four concurrent Ask operations and two exports, independently", async () => {
    const asks = await Promise.all(Array.from({ length: 8 }, () => acquireWorkspaceOperation("ask", "pilot-a")));
    expect(asks.filter(r => r.ok)).toHaveLength(4);
    expect(asks.filter(r => !r.ok)).toEqual(Array(4).fill({ ok: false, code: "WORKSPACE_CONCURRENCY_LIMIT", status: 429 }));
    const exports = await Promise.all(Array.from({ length: 3 }, () => acquireWorkspaceOperation("export", "pilot-a")));
    expect(exports.filter(r => r.ok)).toHaveLength(2);
    expect((await acquireWorkspaceOperation("ask", "pilot-b")).ok).toBe(true);
  });
  it("refuses a concurrent identical key before starting another worker", async () => {
    const first = await acquireWorkspaceOperation("ask", "pilot-a", request());
    expect(first.ok).toBe(true);
    expect(await acquireWorkspaceOperation("ask", "pilot-a", request())).toEqual({ ok: false, code: "IDEMPOTENCY_IN_PROGRESS", status: 409 });
    expect(await acquireWorkspaceOperation("ask", "pilot-a", request("request-0001", undefined, "different question")))
      .toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT", status: 409 });
  });
  it("replays completed output by value and preserves it after release", async () => {
    const lease = await acquireWorkspaceOperation("ask", "pilot-a", request());
    if (!lease.ok || lease.replay) throw new Error("lease missing");
    expect(await lease.complete(answer)).toBe(true); await lease.release();
    const replay = await acquireWorkspaceOperation("ask", "pilot-a", request());
    expect(replay).toEqual({ ok: true, replay: true, value: answer });
    if (replay.ok && replay.replay) replay.value.body.excerpt = "mutated by caller";
    expect(await acquireWorkspaceOperation("ask", "pilot-a", request())).toEqual({ ok: true, replay: true, value: answer });
  });
  it.each(["session:two:world:v1", "session:one:world:v2", "api-key:two:world:v1"])("does not reuse another authorization/world binding: %s", async identity => {
    const lease = await acquireWorkspaceOperation("ask", "pilot-a", request());
    if (!lease.ok || lease.replay) throw new Error("lease missing");
    await lease.complete(answer);
    const next = await acquireWorkspaceOperation("ask", "pilot-a", request("request-0001", identity));
    expect(next.ok && !next.replay).toBe(true);
  });
  it("never caches failed answers and releases them for retry", async () => {
    const lease = await acquireWorkspaceOperation("ask", "pilot-a", request());
    if (!lease.ok || lease.replay) throw new Error("lease missing");
    expect(await lease.complete({ status: 503, body: { code: "OUTAGE" } })).toBe(false);
    await lease.release(); await lease.release();
    const next = await acquireWorkspaceOperation("ask", "pilot-a", request());
    expect(next.ok && !next.replay).toBe(true);
  });
  it("fences a stale worker from completing or releasing its successor", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const first = await acquireWorkspaceOperation("ask", "pilot-a", request());
    if (!first.ok || first.replay) throw new Error("lease missing");
    vi.advanceTimersByTime(76000);
    const next = await acquireWorkspaceOperation("ask", "pilot-a", request());
    expect(next.ok && !next.replay).toBe(true);
    expect(await first.complete(answer)).toBe(false); await first.release();
    expect(await acquireWorkspaceOperation("ask", "pilot-a", request())).toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
  });
  it("refuses oversized cache values instead of storing unbounded customer content", async () => {
    const lease = await acquireWorkspaceOperation("ask", "pilot-a", request());
    if (!lease.ok || lease.replay) throw new Error("lease missing");
    expect(await lease.complete({ status: 200, body: { content: "x".repeat(1_000_001) } })).toBe(false);
  });
});

describe("production durable fail-closed boundary", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    config.mockReturnValue({ url: "https://db.example.test", serviceRoleKey: "unit-test-".repeat(5) });
  });
  it("cannot disable durable protection with a false feature flag in production", async () => {
    config.mockReturnValue(null);
    expect(await acquireWorkspaceOperation("ask", "pilot-a", request())).toEqual({ ok: false, code: "WORKSPACE_GUARD_UNAVAILABLE", status: 503 });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([new Response("missing migration", { status: 404 }), json(null), json({ code: "UNKNOWN" }), json({ code: "ACQUIRED", ownerToken: "foreign" })])("refuses an invalid store response", async response => {
    rpc.mockResolvedValue(response);
    expect(await acquireWorkspaceOperation("ask", "pilot-a", request())).toMatchObject({ ok: false, status: 503 });
  });
  it("refuses an unreachable store, rather than falling back to process-local allowance", async () => {
    rpc.mockRejectedValue(new Error("network unavailable"));
    expect(await acquireWorkspaceOperation("export", "pilot-a")).toMatchObject({ ok: false, status: 503 });
  });
  it.each(["IDEMPOTENCY_IN_PROGRESS", "IDEMPOTENCY_CONFLICT", "WORKSPACE_CONCURRENCY_LIMIT", "WORKSPACE_CACHE_CAPACITY_LIMIT"])("propagates the atomic store decision %s", async code => {
    rpc.mockResolvedValue(json({ code }));
    expect(await acquireWorkspaceOperation("ask", "pilot-a", request())).toEqual({ ok: false, code, status: code.startsWith("WORKSPACE_") ? 429 : 409 });
  });
  it("stores no raw request/key/answer and authenticates encrypted replay binding", async () => {
    const writes: Record<string, unknown>[] = [];
    let ciphertext = "";
    rpc.mockImplementation(async (_config: unknown, path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      writes.push(body);
      if (path.endsWith("acquire_foundation_operation")) {
        return json(ciphertext ? { code: "REPLAY", ciphertext } : { code: "ACQUIRED", ownerToken: body.p_owner_token });
      }
      ciphertext = String(body.p_ciphertext); return json(true);
    });
    const lease = await acquireWorkspaceOperation("ask", "pilot-a", request());
    if (!lease.ok || lease.replay) throw new Error("lease missing");
    expect(await lease.complete(answer)).toBe(true); await lease.release();
    expect(await acquireWorkspaceOperation("ask", "pilot-a", request())).toEqual({ ok: true, replay: true, value: answer });
    expect(JSON.stringify(writes)).not.toContain("private evidence");
    expect(JSON.stringify(writes)).not.toContain(request().body);
    expect(JSON.stringify(writes)).not.toContain(request().key);
    expect(await acquireWorkspaceOperation("ask", "pilot-other", request())).toMatchObject({ ok: false, status: 503 });
    ciphertext = (ciphertext[0] === "A" ? "B" : "A") + ciphertext.slice(1);
    expect(await acquireWorkspaceOperation("ask", "pilot-a", request())).toMatchObject({ ok: false, status: 503 });
  });
  it("rejects malformed keys before contacting the database", async () => {
    expect(await acquireWorkspaceOperation("ask", "pilot-a", request("short"))).toMatchObject({ code: "IDEMPOTENCY_KEY_INVALID", status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("preserves a committed replay when the completion response was lost", async () => {
    let stored = "";
    let releases = 0;
    rpc.mockImplementation(async (_config: unknown, path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (path.endsWith("acquire_foundation_operation")) {
        return json(stored ? { code: "REPLAY", ciphertext: stored } : { code: "ACQUIRED", ownerToken: body.p_owner_token });
      }
      if (body.p_ciphertext !== null) {
        stored = body.p_ciphertext;
        throw new Error("response lost after database commit");
      }
      releases += 1;
      return json(false); // SQL only releases running rows, never a committed replay.
    });
    const lease = await acquireWorkspaceOperation("ask", "pilot-a", request());
    if (!lease.ok || lease.replay) throw new Error("lease missing");
    expect(await lease.complete(answer)).toBe(false);
    await lease.release();
    expect(releases).toBe(1);
    expect(await acquireWorkspaceOperation("ask", "pilot-a", request()))
      .toEqual({ ok: true, replay: true, value: answer });
  });
});

describe("bounded replay retention", () => {
  it("caps distinct live keys without evicting a still-valid replay", async () => {
    for (let i = 0; i < 300; i += 1) {
      const lease = await acquireWorkspaceOperation("ask", "bounded", request(`request-${String(i).padStart(4, "0")}`));
      if (!lease.ok || lease.replay) throw new Error("key admission failed before the bound");
      expect(await lease.complete(answer)).toBe(true);
      await lease.release();
    }
    expect(await acquireWorkspaceOperation("ask", "bounded", request("request-overflow")))
      .toEqual({ ok: false, code: "WORKSPACE_CACHE_CAPACITY_LIMIT", status: 429 });
    expect(await acquireWorkspaceOperation("ask", "bounded", request("request-0000")))
      .toEqual({ ok: true, replay: true, value: answer });
    expect((await acquireWorkspaceOperation("ask", "other-workspace", request("request-overflow"))).ok).toBe(true);
  });

  it("reserves ciphertext capacity before starting large-answer operations", async () => {
    const large = { status: 200, body: { text: "x".repeat(999_900) } };
    for (let i = 0; i < 12; i += 1) {
      const lease = await acquireWorkspaceOperation("ask", "bytes-bounded", request(`request-${String(i).padStart(4, "0")}`));
      if (!lease.ok || lease.replay) throw new Error("unexpected admission failure");
      expect(await lease.complete(large)).toBe(true);
    }
    expect(await acquireWorkspaceOperation("ask", "bytes-bounded", request("request-overflow")))
      .toEqual({ ok: false, code: "WORKSPACE_CACHE_CAPACITY_LIMIT", status: 429 });
  });
});
