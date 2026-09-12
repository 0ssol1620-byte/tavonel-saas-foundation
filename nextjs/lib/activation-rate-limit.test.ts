import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVATION_RATE_LIMIT,
  ACTIVATION_RATE_WINDOW_SECONDS,
  checkActivationRateLimit,
} from "./activation-rate-limit";

/*
  The ceiling FD-02 made necessary.

  A $29 self-serve plan now reaches World promotion, rollback and the retrieval-index rebuild,
  and before this there was no call-frequency limit on any of the three. The three things worth
  holding here are the refusal, the reset, and the direction the limiter fails in: a read it
  cannot complete refuses the request rather than waving it through, because an unbounded
  promote path is what this exists to stop.
*/

const WORKSPACE = "pilot-alpha";
const read = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

let urls: string[];

function rows(count: number, oldestMinutesAgo = 10) {
  urls = [];
  const oldest = Date.now() - oldestMinutesAgo * 60_000;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    urls.push(String(input));
    return Response.json(
      Array.from({ length: count }, (_, index) => ({
        created_at: new Date(oldest + index * 1_000).toISOString(),
        started_at: new Date(oldest + index * 1_000).toISOString(),
      })),
    );
  }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "x".repeat(64));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the per-workspace activation ceiling", () => {
  it("allows a workspace under the limit", async () => {
    rows(ACTIVATION_RATE_LIMIT - 1);
    expect(await checkActivationRateLimit(WORKSPACE, "world_activation")).toEqual({ ok: true });
  });

  it("refuses with 429 and a Retry-After once the window is full", async () => {
    rows(ACTIVATION_RATE_LIMIT, 10);
    const verdict = await checkActivationRateLimit(WORKSPACE, "world_activation");
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("ACTIVATION_RATE_LIMITED");
    expect(verdict.status).toBe(429);
    // Sliding window: the oldest counted event was 10 minutes ago, so it leaves in 50.
    expect(verdict.retryAfterSeconds).toBeGreaterThan(49 * 60);
    expect(verdict.retryAfterSeconds).toBeLessThanOrEqual(50 * 60);
  });

  /*
    The reset, which is the half a limiter gets wrong silently. It is the `gte` cut-off that
    forgets the old rows rather than any expiry job, so the assertion is on the query the read
    actually sends plus the verdict when nothing falls inside it.
  */
  it("counts only the last window, and allows again once it has passed", async () => {
    rows(0);
    expect(await checkActivationRateLimit(WORKSPACE, "world_activation")).toEqual({ ok: true });
    const cutoff = new URL(urls[0]).searchParams.get("created_at") ?? "";
    expect(cutoff.startsWith("gte.")).toBe(true);
    const seconds = Math.round((Date.now() - Date.parse(cutoff.slice(4))) / 1_000);
    expect(seconds).toBeGreaterThanOrEqual(ACTIVATION_RATE_WINDOW_SECONDS - 5);
    expect(seconds).toBeLessThanOrEqual(ACTIVATION_RATE_WINDOW_SECONDS + 5);
  });

  it("reads the index rebuild off its own table and timestamp", async () => {
    rows(0);
    await checkActivationRateLimit(WORKSPACE, "retrieval_index_rebuild");
    expect(urls[0]).toContain("/rest/v1/foundation_retrieval_compile_runs?");
    expect(urls[0]).toContain("started_at=gte.");
    expect(urls[0]).toContain(`workspace_key=eq.${WORKSPACE}`);
  });

  it("fails closed when the ceiling cannot be read", async () => {
    urls = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const verdict = await checkActivationRateLimit(WORKSPACE, "world_activation");
    expect(verdict).toMatchObject({ ok: false, code: "ACTIVATION_RATE_LIMIT_UNAVAILABLE", status: 503 });
  });

  it("fails closed when there is no database to ask", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const verdict = await checkActivationRateLimit(WORKSPACE, "world_activation");
    expect(verdict).toMatchObject({ ok: false, code: "ACTIVATION_RATE_LIMIT_UNAVAILABLE" });
  });

  /*
    A limiter nothing calls is a comment. Each of the three routes FD-02 opened has to consult it
    before it reaches storage or the embedder, and the refusal has to leave the route as a 429
    with the header a client backs off on.
  */
  it.each([
    "app/api/collections/[id]/promote/route.ts",
    "app/api/collections/[id]/world/rollback/route.ts",
    "app/api/v1/collections/[id]/retrieval-index/route.ts",
  ])("%s consults it and answers with Retry-After", (route) => {
    const source = read(route);
    expect(source).toContain("checkActivationRateLimit");
    expect(source).toContain('"Retry-After"');
    expect(source).toContain("ceiling.status");
  });

  it("is documented for the clients that have to branch on the code", () => {
    const docs = read("lib/docs-content.ts");
    expect(docs).toContain("ACTIVATION_RATE_LIMITED");
    expect(docs).toContain(String(ACTIVATION_RATE_LIMIT));
  });
});
