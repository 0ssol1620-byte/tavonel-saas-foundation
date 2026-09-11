/*
  O02 — the difference between "configured" and "proven working", as a measurement.

  /status has always been honest about its own scope: every row it shows is this deployment's
  configuration and activation state, and the page says in as many words that "operational" does
  not mean a request has just succeeded. The audit credited that and then asked for the other
  half, which did not exist: something that actually sends requests through the dependencies and
  records what happened.

  This is that something. It runs on a schedule from the deployment's own cron, sends no customer
  data, and produces one `ProbeRun` per invocation.

  Three rules it is built around, because they are the whole value of the file:

  1. A configuration read is never reported as a successful request. Every check carries a
     `kind`, and `kind: "configuration"` rows can never make `ok` true. The billing row is the
     only configuration row, and it exists because billing has nothing a probe may safely
     exercise -- a synthetic checkout would be a real charge.
  2. A dependency that cannot be reached from this runtime is `not_probed`, with the reason.
     It is never a pass and never a failure. Reporting an unprobed dependency as green is the
     exact defect this file was written to remove, and reporting it as red would page someone
     about a probe that was never wired.
  3. A probe that cannot do its job says so. If the fixture end-to-end run is switched on and
     this file cannot perform it, the run is not `ok` -- it does not quietly fall back to the
     dependency checks and call itself a success.

  What is genuinely proven here, and what is not:

    coreV2   real GET /health, response shape verified.       proven by request
    r2       real PUT + HEAD + DELETE under `synthetic/`.     proven by request
    db       real PostgREST read of a configuration table.    proven by request
    cdr      real authenticated GET /health, when the
             workload-identity variables are present.         proven by request
    ocr      real GET /health, only when explicitly enabled.  gated -- see below
    billing  configuration only.                              never proven by this file

  The OCR endpoint is RunPod serverless with scale-to-zero. A health GET against it can cold-start
  a GPU worker, so probing it every few minutes is a standing spend decision rather than a free
  check: it stays off unless `TAVONEL_PROBE_OCR_HEALTH=1` is set, and the row says why it is off.

  Neither `cdr` nor `ocr` proves a document was sanitized or read. Only the fixture end-to-end
  run does that, and it is not implemented -- see `FIXTURE_E2E_REFUSAL` below.
*/
import { CDR_IDENTITY_AUDIENCE, type CdrIdentityConfig } from "./cdr-workload-identity";
import { readProductCoreV2Env } from "./core-runtime-v2";
import { readPublicOperations } from "./operations";
import {
  FOUNDATION_R2_BUCKET,
  readR2SignerEnv,
  runSyntheticR2Canary,
  type R2SignerEnv,
  type SyntheticCanaryResult,
} from "./r2-synthetic-canary";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

export const PROBE_RUN_SCHEMA = "tavonel.synthetic_probe_run.v1" as const;

/**
 * How long any one dependency gets.
 *
 * IMPLEMENTED_NOT_PROVEN: five seconds is a bound, not a measurement. No latency distribution
 * has been recorded for these endpoints, so this number says "the probe finishes inside one cron
 * invocation", and nothing about what a healthy response time is. A timeout here is reported as
 * `timeout` and is a failure, so raising it to make a red run green would be hiding a result.
 */
export const PROBE_TIMEOUT_MS = 5_000;

/** Order is display order on /status; the runner keeps it. */
export const PROBE_DEPENDENCIES = ["cdr", "ocr", "coreV2", "r2", "db", "billing"] as const;
export type ProbeDependency = (typeof PROBE_DEPENDENCIES)[number];

export type ProbeErrorClass =
  /** No target is configured for this check in this deployment. */
  | "not_configured"
  /** Deliberately not probed because the probe itself would cost GPU time. */
  | "gpu_spend_gate"
  | "timeout"
  | "unreachable"
  | "http_error"
  | "unexpected_response"
  /** The probe was asked to do something it cannot do. Never a dependency's fault. */
  | "probe_refused";

export type ProbeCheck = {
  name: ProbeDependency;
  /** What the row is evidence of. `configuration` is never evidence that a request succeeded. */
  kind: "request" | "configuration";
  status: "ok" | "failed" | "not_probed";
  /** Null whenever no request was sent. Never zero as a stand-in. */
  latencyMs: number | null;
  errorClass: ProbeErrorClass | null;
};

export type ProbeRun = {
  schemaVersion: typeof PROBE_RUN_SCHEMA;
  startedAt: string;
  durationMs: number;
  /**
   * True only when at least one dependency was actually exercised by a request and nothing
   * failed. A run in which everything was `not_probed` is not a successful probe.
   */
  ok: boolean;
  checks: ProbeCheck[];
  fixtureE2E: {
    enabled: boolean;
    status: "not_enabled" | "refused";
    code: string | null;
  };
};

/*
  The fixture end-to-end run, and why this file refuses it rather than pretending.

  What was asked for: a public-domain fixture PDF into a dedicated internal probe workspace,
  through quarantine, CDR, OCR and compile, verify a candidate, delete the artifacts. That would
  prove the two rows above that a health check cannot -- that a document really was sanitized and
  really was read.

  It is not implemented, and the reason is structural rather than effort: the pipeline is
  asynchronous and cron-driven. Quarantine hands off to a Cloud Run service that calls back in,
  OCR is dispatched by the CDR worker against a scale-to-zero GPU, and the compile turn is taken
  by /api/internal/jobs/run one batch at a time. A single bounded probe invocation cannot observe
  any of that end to end; doing it properly means a durable probe job that spans invocations,
  which is a piece of work with its own review, not a branch inside this function.

  So the flag exists, defaults off, and when it is switched on the run reports `refused` and is
  not `ok`. That is deliberate: an operator who turns this on is asking for end-to-end proof, and
  the worst possible answer is a green probe that quietly checked six health endpoints instead.

  The founder question that has to be answered before it is built is in the lane report, and it
  is not a scheduling question: does a synthetic fixture PDF put through the real pipeline in a
  dedicated internal workspace count as "customer data processing" under the gate in
  `activation-policy.ts`, which is false until a receipt is recorded? The fixture is public-domain
  and belongs to no customer, so the honest reading is no -- but that gate is the founder's, the
  run would exercise every path the gate covers, and this file will not decide it.
*/
export const FIXTURE_E2E_REFUSAL = "PROBE_FIXTURE_E2E_NOT_IMPLEMENTED" as const;

export type ProbeDependencies = {
  env?: NodeJS.ProcessEnv;
  /** Injected so a test can force each outcome; production passes the real canary. */
  r2Canary?: (env: R2SignerEnv) => Promise<SyntheticCanaryResult>;
  /** Vercel OIDC. Absent outside Vercel, which makes the CDR row `not_probed`. */
  cdrSubject?: () => Promise<string>;
  cdrMint?: (config: CdrIdentityConfig, subject: string) => Promise<string>;
  now?: () => number;
};

function notProbed(name: ProbeDependency, errorClass: ProbeErrorClass, kind: ProbeCheck["kind"] = "request"): ProbeCheck {
  return { name, kind, status: "not_probed", latencyMs: null, errorClass };
}

/** A thrown error becomes a class, never a message: provider text can carry a token. */
function classify(cause: unknown): ProbeErrorClass {
  if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) return "timeout";
  return "unreachable";
}

async function timed(
  name: ProbeDependency,
  run: () => Promise<ProbeErrorClass | null>,
  clock: () => number,
): Promise<ProbeCheck> {
  const started = clock();
  try {
    const failure = await run();
    return {
      name,
      kind: "request",
      status: failure ? "failed" : "ok",
      latencyMs: clock() - started,
      errorClass: failure,
    };
  } catch (cause) {
    return { name, kind: "request", status: "failed", latencyMs: clock() - started, errorClass: classify(cause) };
  }
}

/** Every health endpoint this deployment owns answers `{ "status": "ok", ... }`. */
async function healthOk(response: Response): Promise<ProbeErrorClass | null> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return "http_error";
  }
  const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
  return body?.status === "ok" ? null : "unexpected_response";
}

function health(url: string, headers?: Record<string, string>) {
  return fetch(url, {
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
}

async function checkCoreV2(clock: () => number): Promise<ProbeCheck> {
  const core = readProductCoreV2Env();
  if (!core) return notProbed("coreV2", "not_configured");
  return timed("coreV2", async () => {
    const response = await health(`${core.url}/health`);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return "http_error";
    }
    const body = (await response.json().catch(() => null)) as { status?: unknown; runtime?: unknown } | null;
    // The runtime name is checked as well as the status: a 200 from something else on that
    // hostname is not evidence that Core V2 is up.
    return body?.status === "ok" && body?.runtime === "tavonel-python-core-v2" ? null : "unexpected_response";
  }, clock);
}

async function checkR2(
  env: NodeJS.ProcessEnv,
  canary: (signer: R2SignerEnv) => Promise<SyntheticCanaryResult>,
  clock: () => number,
): Promise<ProbeCheck> {
  const signer = readR2SignerEnv(env);
  if (!signer || signer.bucket !== FOUNDATION_R2_BUCKET) return notProbed("r2", "not_configured");
  // A real write, read and delete under the `synthetic/` prefix. This is the one dependency that
  // was already exercisable before this file existed; nothing ran it on a schedule.
  return timed("r2", async () => ((await canary(signer)).ok ? null : "http_error"), clock);
}

async function checkDatabase(
  env: NodeJS.ProcessEnv,
  clock: () => number,
): Promise<ProbeCheck> {
  const config = readSupabaseAdminConfig(env);
  if (!config) return notProbed("db", "not_configured");
  return timed("db", async () => {
    /*
      A configuration table, read with an explicit column list and a limit. `foundation_trial_policy`
      holds one row of policy and no customer data, so a probe that reads it proves the connection,
      the service-role grant and the row-level-security path without touching a tenant.
    */
    const response = await supabaseAdminRequest(config, "/rest/v1/foundation_trial_policy?select=policy_key&limit=1", {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return "http_error";
    }
    const rows = await response.json().catch(() => null);
    return Array.isArray(rows) ? null : "unexpected_response";
  }, clock);
}

async function checkCdr(
  env: NodeJS.ProcessEnv,
  deps: ProbeDependencies,
  clock: () => number,
): Promise<ProbeCheck> {
  const providerResource = env.FOUNDATION_CDR_WIF_PROVIDER?.trim() ?? "";
  const serviceAccount = env.FOUNDATION_CDR_WIF_SERVICE_ACCOUNT?.trim() ?? "";
  if (
    env.FOUNDATION_CDR_IDENTITY_ENABLED !== "1" ||
    !providerResource ||
    !serviceAccount ||
    !deps.cdrSubject ||
    !deps.cdrMint
  ) {
    return notProbed("cdr", "not_configured");
  }
  const { cdrSubject, cdrMint } = deps;
  return timed("cdr", async () => {
    // The sanitizer is IAM-only, so an unauthenticated GET proves nothing about it. Minting the
    // same workload-identity token the worker uses is what makes this a real check -- and it
    // exercises the STS exchange too, which is its own dependency.
    const token = await cdrMint({ providerResource, serviceAccount }, await cdrSubject());
    return healthOk(await health(`${CDR_IDENTITY_AUDIENCE}/health`, { authorization: `Bearer ${token}` }));
  }, clock);
}

async function checkOcr(
  env: NodeJS.ProcessEnv,
  clock: () => number,
): Promise<ProbeCheck> {
  // Off unless someone decided to pay for it. See the spend note in the file header.
  if (env.TAVONEL_PROBE_OCR_HEALTH !== "1") return notProbed("ocr", "gpu_spend_gate");
  const url = env.FOUNDATION_OCR_URL?.trim() ?? "";
  if (!/^https:\/\/[^\s]+$/.test(url)) return notProbed("ocr", "not_configured");
  return timed("ocr", async () => healthOk(await health(`${url.replace(/\/$/, "")}/health`)), clock);
}

function checkBilling(): ProbeCheck {
  // Configuration, and labelled as configuration. There is no safe synthetic charge: a probe
  // through Paddle checkout would be a real transaction against a real card.
  const configured = readPublicOperations().readiness.billingConfigured;
  return configured
    ? { name: "billing", kind: "configuration", status: "ok", latencyMs: null, errorClass: null }
    : notProbed("billing", "not_configured", "configuration");
}

export async function runSyntheticProbe(deps: ProbeDependencies = {}): Promise<ProbeRun> {
  const env = deps.env ?? process.env;
  const clock = deps.now ?? Date.now;
  const canary = deps.r2Canary ?? runSyntheticR2Canary;
  const startedAtMs = clock();

  // Sequential on purpose. These are six requests once every few minutes, and a probe that
  // fans out measures its own contention as well as the dependency's latency.
  const checks: ProbeCheck[] = [
    await checkCdr(env, deps, clock),
    await checkOcr(env, clock),
    await checkCoreV2(clock),
    await checkR2(env, canary, clock),
    await checkDatabase(env, clock),
    checkBilling(),
  ];

  const fixtureEnabled = env.TAVONEL_PROBE_FIXTURE_E2E === "1";
  const fixtureE2E = fixtureEnabled
    ? { enabled: true, status: "refused" as const, code: FIXTURE_E2E_REFUSAL }
    : { enabled: false, status: "not_enabled" as const, code: null };

  const exercised = checks.some((check) => check.kind === "request" && check.status === "ok");
  const failed = checks.some((check) => check.status === "failed");
  return {
    schemaVersion: PROBE_RUN_SCHEMA,
    startedAt: new Date(startedAtMs).toISOString(),
    durationMs: clock() - startedAtMs,
    ok: exercised && !failed && fixtureE2E.status !== "refused",
    checks,
    fixtureE2E,
  };
}

/** Reject anything that is not a run this deployment wrote. Storage is read back, so it is input. */
export function validateProbeRun(value: unknown): ProbeRun | null {
  if (!value || typeof value !== "object") return null;
  const run = value as Partial<ProbeRun>;
  if (
    run.schemaVersion !== PROBE_RUN_SCHEMA ||
    typeof run.startedAt !== "string" ||
    !Number.isFinite(Date.parse(run.startedAt)) ||
    !Number.isSafeInteger(run.durationMs) ||
    (run.durationMs ?? -1) < 0 ||
    typeof run.ok !== "boolean" ||
    !Array.isArray(run.checks) ||
    run.checks.length !== PROBE_DEPENDENCIES.length ||
    !run.fixtureE2E ||
    typeof run.fixtureE2E !== "object"
  ) return null;
  for (const entry of run.checks as unknown[]) {
    if (!entry || typeof entry !== "object") return null;
    const check = entry as Partial<ProbeCheck>;
    if (
      !PROBE_DEPENDENCIES.includes(check.name as ProbeDependency) ||
      !["request", "configuration"].includes(check.kind as string) ||
      !["ok", "failed", "not_probed"].includes(check.status as string) ||
      !(check.latencyMs === null || (Number.isSafeInteger(check.latencyMs) && (check.latencyMs ?? -1) >= 0)) ||
      !(check.errorClass === null || typeof check.errorClass === "string")
    ) return null;
  }
  return run as ProbeRun;
}
