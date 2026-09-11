/*
  O02 — every dependency's ok, failure and timeout, and the two things the probe must never do:
  report a configuration read as a proven request, and report a green run when it was asked for an
  end-to-end fixture it cannot perform.
*/
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPublicOperations } from "./operations";

// The billing row is the one check that consults a readiness helper reading ambient process
// state. It is mocked so the test can say "billing is configured on this host" without the
// seven real variables, which is exactly the production-build condition that broke the probe.
vi.mock("./operations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./operations")>();
  return { ...actual, readPublicOperations: vi.fn(actual.readPublicOperations) };
});
import {
  FIXTURE_E2E_REFUSAL,
  PROBE_DEPENDENCIES,
  PROBE_RUN_SCHEMA,
  PROBE_TIMEOUT_MS,
  runSyntheticProbe,
  validateProbeRun,
  type ProbeDependency,
  type ProbeEnv,
} from "./synthetic-probe";

const CORE_URL = "https://core-v2.example.invalid";
const OCR_URL = "https://ocr.example.invalid";

const DATABASE_ONLY = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"s".repeat(31)}`,
};

/*
  The environment a run is given, built rather than exported.

  This used to call `vi.stubEnv` and let the probe read `process.env`, which made the
  unconfigured cases depend on what the host had not set -- green on a laptop, red on Vercel,
  where R2 credentials are real. The probe now takes its environment as an argument, so a test
  says what is configured and nothing else is.
*/
function configured(extra: Record<string, string> = {}): ProbeEnv {
  return {
    FOUNDATION_CORE_V2_URL: CORE_URL,
    FOUNDATION_CORE_V2_HMAC: "c".repeat(48),
    ...DATABASE_ONLY,
    ...extra,
  };
}

const r2Env = {
  R2_ACCOUNT_ID: "account",
  R2_BUCKET: "tavonel-saas-foundation-quarantine",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
};

/** A fetch that answers per URL, so one stub serves six different dependencies. */
function router(handlers: Array<[string, () => Promise<Response>]>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const handler = handlers.find(([match]) => url.includes(match));
    if (!handler) throw new Error(`unrouted probe request: ${url}`);
    return handler[1]();
  });
}

function json(body: unknown, status = 200) {
  return async () => new Response(JSON.stringify(body), { status });
}

function timeout() {
  return async () => {
    // What `AbortSignal.timeout` produces, which is what the runner classifies on.
    const error = new Error("The operation was aborted due to timeout");
    error.name = "TimeoutError";
    throw error;
  };
}

const coreHealthy = json({ status: "ok", runtime: "tavonel-python-core-v2" });
const dbHealthy = json([{ policy_key: "default" }]);

function check(run: Awaited<ReturnType<typeof runSyntheticProbe>>, name: ProbeDependency) {
  return run.checks.find((candidate) => candidate.name === name)!;
}

describe("synthetic probe run", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("passes when every configured dependency answers, and keeps billing labelled configuration", async () => {
    vi.stubGlobal("fetch", router([["core-v2", coreHealthy], ["supabase.co", dbHealthy]]));
    const run = await runSyntheticProbe({
      env: configured(r2Env),
      r2Canary: async () => ({ ok: true, code: "SYNTHETIC_CANARY_OK" }),
      now: (() => { let t = 1_757_000_000_000; return () => (t += 25); })(),
    });

    expect(run.schemaVersion).toBe(PROBE_RUN_SCHEMA);
    expect(run.ok).toBe(true);
    expect(run.checks.map((entry) => entry.name)).toEqual([...PROBE_DEPENDENCIES]);
    for (const name of ["coreV2", "r2", "db"] as const) {
      expect(check(run, name)).toMatchObject({ kind: "request", status: "ok", errorClass: null });
      expect(check(run, name).latencyMs).toBeGreaterThanOrEqual(0);
    }
    // The one row that is not evidence of a request, and it says so in the row itself.
    expect(check(run, "billing").kind).toBe("configuration");
    // No request is ever sent through billing, so it has no latency to report.
    expect(check(run, "billing").latencyMs).toBeNull();
  });

  it.each([
    ["an error status", json({ detail: "boom" }, 503), "http_error"],
    ["a body from something else on that host", json({ status: "ok", runtime: "nginx" }), "unexpected_response"],
    ["no answer inside the limit", timeout(), "timeout"],
  ])("fails the compiler-core check on %s", async (_label, handler, errorClass) => {
    vi.stubGlobal("fetch", router([["core-v2", handler], ["supabase.co", dbHealthy]]));
    const run = await runSyntheticProbe({ env: configured(), r2Canary: async () => ({ ok: true, code: "SYNTHETIC_CANARY_OK" }) });
    expect(check(run, "coreV2")).toMatchObject({ status: "failed", errorClass });
    // One failed dependency fails the run. There is no partial pass.
    expect(run.ok).toBe(false);
  });

  it("fails the storage check when the canary round trip does not complete", async () => {
    vi.stubGlobal("fetch", router([["core-v2", coreHealthy], ["supabase.co", dbHealthy]]));
    const run = await runSyntheticProbe({ env: configured(r2Env), r2Canary: async () => ({ ok: false, code: "PUT_FAILED", put: 403 }) });
    expect(check(run, "r2")).toMatchObject({ status: "failed", errorClass: "http_error" });
    expect(run.ok).toBe(false);
  });

  it.each([
    ["a refused read", json({ message: "permission denied" }, 401), "http_error"],
    ["a body that is not rows", json({ policy_key: "default" }), "unexpected_response"],
    ["no answer inside the limit", timeout(), "timeout"],
  ])("fails the database check on %s", async (_label, handler, errorClass) => {
    vi.stubGlobal("fetch", router([["core-v2", coreHealthy], ["supabase.co", handler]]));
    const run = await runSyntheticProbe({ env: configured(), r2Canary: async () => ({ ok: true, code: "SYNTHETIC_CANARY_OK" }) });
    expect(check(run, "db")).toMatchObject({ status: "failed", errorClass });
    expect(run.ok).toBe(false);
  });

  it("reports an unconfigured dependency as not probed, which is neither a pass nor a failure", async () => {
    // Core V2 and storage absent; only the database is configured. Said, not assumed from a
    // variable the host did not happen to export.
    vi.stubGlobal("fetch", router([["supabase.co", dbHealthy]]));
    const run = await runSyntheticProbe({ env: DATABASE_ONLY });
    expect(check(run, "coreV2")).toMatchObject({ status: "not_probed", errorClass: "not_configured", latencyMs: null });
    expect(check(run, "r2")).toMatchObject({ status: "not_probed", errorClass: "not_configured" });
    expect(check(run, "db").status).toBe("ok");
    expect(run.ok).toBe(true);
  });

  it("is not a successful probe when nothing at all was exercised", async () => {
    vi.stubGlobal("fetch", router([]));
    const run = await runSyntheticProbe({});
    expect(run.checks.every((entry) => entry.status === "not_probed")).toBe(true);
    // The failure mode this guards: six grey rows and a green summary.
    expect(run.ok).toBe(false);
  });

  it("does not let the host environment decide whether billing was exercised", async () => {
    // The production build failed on exactly this: Paddle is configured on Vercel, the billing
    // row read it from process state, and a probe handed an empty environment reported one
    // green configuration row. The injected environment is the only one a check may consult.
    vi.mocked(readPublicOperations).mockReturnValueOnce({ readiness: { billingConfigured: true } } as never);
    vi.stubGlobal("fetch", router([]));
    const run = await runSyntheticProbe({});
    expect(check(run, "billing")).toMatchObject({ status: "not_probed", errorClass: "not_configured", kind: "configuration" });
    expect(run.ok).toBe(false);
  });
  it("leaves the GPU OCR endpoint alone unless someone has accepted the cold-start cost", async () => {
    const env = configured({ FOUNDATION_OCR_URL: OCR_URL });
    const fetcher = router([["core-v2", coreHealthy], ["supabase.co", dbHealthy]]);
    vi.stubGlobal("fetch", fetcher);
    const gated = await runSyntheticProbe({ env, r2Canary: async () => ({ ok: true, code: "SYNTHETIC_CANARY_OK" }) });
    expect(check(gated, "ocr")).toMatchObject({ status: "not_probed", errorClass: "gpu_spend_gate" });
    expect(fetcher.mock.calls.every(([input]) => !String(input).includes("ocr.example"))).toBe(true);

    vi.stubGlobal("fetch", router([
      ["core-v2", coreHealthy],
      ["supabase.co", dbHealthy],
      ["ocr.example", json({ status: "ok", gpu: true, engine: "rapidocr" })],
    ]));
    const enabled = await runSyntheticProbe({
      env: { ...env, TAVONEL_PROBE_OCR_HEALTH: "1" },
      r2Canary: async () => ({ ok: true, code: "SYNTHETIC_CANARY_OK" }),
    });
    expect(check(enabled, "ocr")).toMatchObject({ kind: "request", status: "ok" });
  });

  it("mints a workload-identity token for the sanitizer and reports its failures", async () => {
    const env = configured({
      FOUNDATION_CDR_IDENTITY_ENABLED: "1",
      FOUNDATION_CDR_WIF_PROVIDER: "projects/317850201666/locations/global/workloadIdentityPools/pool/providers/provider",
      FOUNDATION_CDR_WIF_SERVICE_ACCOUNT: "cdr-probe@tavonel-saas-foundation.iam.gserviceaccount.com",
    });
    const authorizations: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("run.app")) {
        authorizations.push(String((init?.headers as Record<string, string> | undefined)?.authorization));
        return new Response(JSON.stringify({ status: "ok", scannerReady: true }), { status: 200 });
      }
      if (url.includes("core-v2")) return coreHealthy();
      return dbHealthy();
    }));
    const healthy = await runSyntheticProbe({
      env,
      r2Canary: async () => ({ ok: true, code: "SYNTHETIC_CANARY_OK" }),
      cdrSubject: async () => "vercel-oidc-subject-token",
      cdrMint: async () => "cdr-id-token",
    });
    expect(check(healthy, "cdr")).toMatchObject({ kind: "request", status: "ok" });
    // Unauthenticated would prove nothing: the sanitizer is IAM-only.
    expect(authorizations).toEqual(["Bearer cdr-id-token"]);

    const minting = await runSyntheticProbe({
      env,
      r2Canary: async () => ({ ok: true, code: "SYNTHETIC_CANARY_OK" }),
      cdrSubject: async () => "vercel-oidc-subject-token",
      cdrMint: async () => { throw new Error("CDR_IDENTITY_UNAVAILABLE"); },
    });
    expect(check(minting, "cdr")).toMatchObject({ status: "failed", errorClass: "unreachable" });
    expect(minting.ok).toBe(false);
  });

  it("refuses the fixture end-to-end run rather than reporting a pass it did not earn", async () => {
    vi.stubGlobal("fetch", router([["core-v2", coreHealthy], ["supabase.co", dbHealthy]]));
    const run = await runSyntheticProbe({
      env: configured({ ...r2Env, TAVONEL_PROBE_FIXTURE_E2E: "1" }),
      r2Canary: async () => ({ ok: true, code: "SYNTHETIC_CANARY_OK" }),
    });
    expect(run.fixtureE2E).toEqual({ enabled: true, status: "refused", code: FIXTURE_E2E_REFUSAL });
    // Every dependency answered, and the run still does not pass, because the operator asked for
    // something else. This is the assertion that stops the flag becoming a lie.
    expect(run.checks.some((entry) => entry.status === "failed")).toBe(false);
    expect(run.ok).toBe(false);
  });

  it("keeps the per-dependency time limit bounded and documented", () => {
    expect(PROBE_TIMEOUT_MS).toBe(5_000);
    // Six sequential checks must fit inside the route's declared 60 s wall clock.
    expect(PROBE_DEPENDENCIES.length * PROBE_TIMEOUT_MS).toBeLessThan(60_000);
  });
});

/*
  The wiring, asserted on the files.

  The route imports the Vercel OIDC helper, which only exists inside a Vercel function, so it is
  not imported here -- and a probe nothing calls is worth nothing, so the schedule and the gate
  are checked as text. This is the same device `execution-budget.test.ts` uses to keep the jobs
  route's declared wall clock tied to the budget it is derived from.
*/
describe("probe scheduling and protection", () => {
  const root = resolve(import.meta.dirname, "..");
  const route = readFileSync(resolve(root, "app/api/internal/probe/route.ts"), "utf8");
  const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };

  it("is on the cron, alongside the jobs worker and not instead of it", () => {
    const paths = vercel.crons.map((entry) => entry.path);
    expect(paths).toContain("/api/internal/probe");
    expect(paths).toContain("/api/internal/jobs/run");
    expect(vercel.crons.find((entry) => entry.path === "/api/internal/probe")!.schedule).toBe("*/5 * * * *");
  });

  it("is closed to anything without one of the two infrastructure secrets", () => {
    // Vercel Cron presents CRON_SECRET as a Bearer token; the manual worker secret stays
    // separately rotatable. Both are compared in constant time by the shared helper, and a
    // secret under 32 characters counts as absent -- with neither set the route answers 401.
    expect(route).toContain("authorizeSyntheticCanary");
    expect(route).toContain("process.env.CRON_SECRET");
    expect(route).toContain("process.env.FOUNDATION_WORKER_SECRET");
    expect(route).toContain("value.length >= 32");
    expect(route).toContain('{ code: "PROBE_NOT_AUTHORIZED" }');
  });

  it("declares a wall clock the sequential checks fit inside", () => {
    const declared = Number(/export const maxDuration = (\d+);/.exec(route)?.[1]);
    expect(declared * 1_000).toBeGreaterThanOrEqual(PROBE_DEPENDENCIES.length * PROBE_TIMEOUT_MS);
  });

  it("refuses to overwrite the history it could not read", () => {
    // One object holds every run, so a write without a successful read would destroy the rest.
    expect(route).toContain("const previous = await readProbeHistory(signer)");
    expect(route).toContain("if (!previous.ok)");
  });
});

describe("stored probe run validation", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("accepts a run it produced and rejects anything else", async () => {
    vi.stubGlobal("fetch", router([["core-v2", coreHealthy], ["supabase.co", dbHealthy]]));
    const run = await runSyntheticProbe({ env: configured(r2Env), r2Canary: async () => ({ ok: true, code: "SYNTHETIC_CANARY_OK" }) });
    expect(validateProbeRun(JSON.parse(JSON.stringify(run)))).toEqual(run);

    expect(validateProbeRun(null)).toBeNull();
    expect(validateProbeRun({ ...run, schemaVersion: "tavonel.synthetic_probe_run.v2" })).toBeNull();
    expect(validateProbeRun({ ...run, startedAt: "not a date" })).toBeNull();
    expect(validateProbeRun({ ...run, ok: "true" })).toBeNull();
    expect(validateProbeRun({ ...run, checks: run.checks.slice(1) })).toBeNull();
    expect(validateProbeRun({ ...run, checks: [...run.checks.slice(1), { name: "elsewhere", kind: "request", status: "ok", latencyMs: 1, errorClass: null }] })).toBeNull();
    expect(validateProbeRun({ ...run, checks: run.checks.map((entry) => ({ ...entry, latencyMs: -1 })) })).toBeNull();
  });
});
