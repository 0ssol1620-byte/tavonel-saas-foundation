import * as nodeCrypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every receiver host in this file resolves to a public address; nothing leaves the process.
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

import { activationPolicy } from "./activation-policy";
import {
  CHANGE_NOTIFY_HEADERS,
  CHANGE_NOTIFY_MAX_ATTEMPTS,
  CHANGE_NOTIFY_RETRY_DELAYS_SECONDS,
  canonicalJson,
  changeDeliveryId,
  readChangeNotifyConfig,
  runChangeNotifyTurn,
  workspaceSigningKey,
} from "./change-notify";
import { findDocsSection } from "./docs-content";

/*
  G8 CHANGE-NOTIFY. The sender is exercised against a fake PostgREST that keeps the outbox the
  migration defines, and against receivers built from the verification snippet /docs/run-events
  publishes -- so "the documented receiver accepts what the sender signs" is a test, not a claim.
*/

const SECRET = "s".repeat(40);
const A = "pilot-alpha";
const B = "pilot-beta";
const HOOK = { [A]: "https://hooks.alpha.example/tavonel", [B]: "https://hooks.beta.example/tavonel" };
const COLLECTION_A = `collection-${"a".repeat(32)}`;
const COLLECTION_B = `collection-${"b".repeat(32)}`;
// The form the database holds (`sha256:` + 64 hex), not bare hex: a bare-hex fixture is how the
// sender once passed every test here and detected nothing on a real row.
const DIGEST = (c: string) => `sha256:${c.repeat(64)}`;
const STORE = "https://db.example.supabase.co";

// The CHECKs the real tables enforce, read from the migrations themselves. The fake store below
// refuses a fixture the database would refuse, so the fixtures cannot drift from the schema again.
const migration = (file: string) => readFileSync(resolve(import.meta.dirname, "../../supabase/migrations", file), "utf8");
const checkIn = (sql: string, pattern: RegExp) => new RegExp(sql.match(pattern)![1]!);
const DB_SHAPE = {
  // foundation_compile_jobs_candidate_digest_shape
  candidate: checkIn(migration("20260911120200_compile_job_candidate_manifest_digest.sql"), /candidate_manifest_digest ~ '([^']+)'/),
  // foundation_active_worlds.manifest_digest references foundation_world_versions, which checks this.
  active: checkIn(migration("0007_foundation_world_lifecycle.sql"), /manifest_digest text not null check \(manifest_digest ~ '([^']+)'\)/),
  collection: checkIn(migration("0038_foundation_compile_jobs.sql"), /collection_id ~ '([^']+)'/),
};

const env = (endpoints: Record<string, string> = HOOK, extra: Record<string, string> = {}) => ({
  TAVONEL_CHANGE_NOTIFY_ENABLED: "1",
  TAVONEL_CHANGE_NOTIFY_SECRET: SECRET,
  TAVONEL_CHANGE_NOTIFY_ENDPOINTS: JSON.stringify(endpoints),
  NEXT_PUBLIC_SUPABASE_URL: STORE,
  SUPABASE_SERVICE_ROLE_KEY: "k".repeat(40),
  ...extra,
});

// --- the published receiver, compiled from the docs ------------------------------------------
type Verify = (headers: Headers, rawBody: string, signingKey: string) => Record<string, unknown> | null;
const snippet = findDocsSection("run-events")!.blocks.find(
  (block) => block.kind === "code" && block.label.startsWith("Verify a change notification"),
) as { body: string };
const verifyFromDocs: Verify = (() => {
  const js = ts.transpileModule(snippet.body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported: Record<string, unknown> = {};
  new Function("require", "exports", js)((id: string) => {
    if (id === "node:crypto") return nodeCrypto;
    throw new Error(`the docs snippet imports ${id}`);
  }, exported);
  return exported.verifyTavonelNotification as Verify;
})();

// --- a fake PostgREST holding the tables the turn reads and the outbox it writes --------------
type Row = Record<string, unknown>;
let jobs: Row[];
let pointers: Row[];
let outbox: Row[];
let storeDown: boolean;
let enforceDbShape: boolean;
let refusedByDb: string[];
let storeReads: string[];
type Sent = { host: string; headers: Headers; body: string; signal: unknown };
let sent: Sent[];
let receivers: Record<string, (sent: Sent) => Promise<Response> | Response>;
let clock: number;

const list = (value: string | null) => (value ?? "").replace(/^in\.\(|\)$/g, "").split(",");
const eq = (value: string | null) => (value ?? "").replace(/^eq\./, "");

function filterRows(rows: Row[], query: URLSearchParams) {
  return rows.filter((row) => [...query.entries()].every(([key, value]) => {
    if (["select", "order", "limit", "on_conflict"].includes(key)) return true;
    if (value.startsWith("in.")) return list(value).includes(String(row[key]));
    if (value === "not.is.null") return row[key] !== null && row[key] !== undefined;
    if (value.startsWith("gte.")) return Date.parse(String(row[key])) >= Date.parse(value.slice(4));
    if (value.startsWith("lte.")) return Date.parse(String(row[key])) <= Date.parse(value.slice(4));
    if (value.startsWith("eq.")) return String(row[key]) === eq(value);
    throw new Error(`unhandled filter ${key}=${value}`);
  }));
}

/** A GET as PostgREST answers it: filtered, ordered, limited. */
function select(rows: Row[], query: URLSearchParams) {
  const [column, direction] = (query.get("order") ?? "").split(".");
  const matched = filterRows(rows, query);
  if (column) matched.sort((left, right) => (Date.parse(String(left[column])) - Date.parse(String(right[column]))) * (direction === "desc" ? -1 : 1));
  return matched.slice(0, Number(query.get("limit") ?? "1000")).map((row) => structuredClone(row));
}

/** Only rows the real table could hold; any other fixture is recorded and fails the test in afterEach. */
function dbHolds(rows: Row[], shapes: Record<string, RegExp>) {
  return rows.filter((row) => Object.entries(shapes).every(([column, shape]) => {
    if (!enforceDbShape || row[column] == null || shape.test(String(row[column]))) return true;
    refusedByDb.push(`${column}=${String(row[column])}`);
    return false;
  }));
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  if (url.origin === STORE) {
    storeReads.push(`${init.method ?? "GET"} ${url.pathname}?${url.searchParams}`);
    if (storeDown) return new Response("down", { status: 503 });
    const table = url.pathname.replace("/rest/v1/", "");
    const method = init.method ?? "GET";
    if (table === "foundation_compile_jobs") {
      return Response.json(select(dbHolds(jobs, { candidate_manifest_digest: DB_SHAPE.candidate, collection_id: DB_SHAPE.collection }), url.searchParams));
    }
    if (table === "foundation_active_worlds") return Response.json(select(dbHolds(pointers, { manifest_digest: DB_SHAPE.active }), url.searchParams));
    if (table !== "foundation_change_notifications") throw new Error(`unexpected table ${table}`);
    if (method === "POST") {
      const inserted: Row[] = [];
      for (const row of JSON.parse(String(init.body)) as Row[]) {
        const event = row.event as Row;
        // foundation_change_notifications_event_identity
        if (event.deliveryId !== row.delivery_id || event.workspaceKey !== row.workspace_key) return new Response("check", { status: 400 });
        if (outbox.some((existing) => existing.delivery_id === row.delivery_id)) continue;
        const stored = { ...row, state: "pending", attempt: 0, available_at: new Date(clock).toISOString(), created_at: new Date(clock).toISOString(),
          last_status: null, last_error: null, dead_letter_receipt: null, delivered_at: null, dead_at: null };
        outbox.push(stored);
        inserted.push(stored);
      }
      return Response.json(inserted, { status: 201 });
    }
    if (method === "PATCH") {
      const patch = JSON.parse(String(init.body)) as Row;
      const matched = filterRows(outbox, url.searchParams);
      for (const row of matched) {
        Object.assign(row, patch);
        // foundation_change_notifications_outcome
        if ((row.state === "delivered") !== (row.delivered_at != null)) throw new Error("outcome check");
        if ((row.state === "dead") !== (row.dead_at != null && row.dead_letter_receipt != null)) throw new Error("outcome check");
      }
      return Response.json(matched.map((row) => ({ ...row })));
    }
    return Response.json(select(outbox, url.searchParams));
  }
  const delivery: Sent = { host: url.host, headers: new Headers(init.headers), body: String(init.body), signal: init.signal };
  sent.push(delivery);
  const receiver = receivers[url.host];
  if (!receiver) throw new Error(`no receiver at ${url.host}`);
  return receiver(delivery);
}

const ok = () => new Response("ok", { status: 200 });
const at = (ms: number) => { clock = ms; vi.setSystemTime(ms); };
const advance = (seconds: number) => at(clock + seconds * 1_000);
const job = (workspace: string, collection: string, digest: string, state = "ready") =>
  ({ workspace_key: workspace, collection_id: collection, candidate_manifest_digest: digest, state, updated_at: new Date(clock - 60_000).toISOString() });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(Date.parse("2026-10-19T06:00:00.000Z"));
  jobs = [];
  pointers = [];
  outbox = [];
  storeDown = false;
  enforceDbShape = true;
  refusedByDb = [];
  storeReads = [];
  sent = [];
  receivers = { "hooks.alpha.example": ok, "hooks.beta.example": ok };
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  expect(refusedByDb, "a fixture the database would refuse").toEqual([]);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the rollout switch", () => {
  it("is off unless TAVONEL_CHANGE_NOTIFY_ENABLED is exactly 1, and off does no I/O at all", async () => {
    for (const enabled of [undefined, "", "0", "true", "yes"]) {
      const environment = { ...env(), TAVONEL_CHANGE_NOTIFY_ENABLED: enabled };
      expect(readChangeNotifyConfig(environment)).toEqual({ enabled: false, code: "CHANGE_NOTIFY_DISABLED" });
      expect(await runChangeNotifyTurn(environment)).toEqual({ code: "CHANGE_NOTIFY_DISABLED", enabled: false });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses to run without a usable secret or with any invalid endpoint", () => {
    expect(readChangeNotifyConfig(env(HOOK, { TAVONEL_CHANGE_NOTIFY_SECRET: "short" }))).toEqual({ enabled: false, code: "CHANGE_NOTIFY_SECRET_MISSING" });
    for (const endpoints of [
      "not json", "[]", "null",
      JSON.stringify({ [A]: "http://hooks.alpha.example/" }),
      JSON.stringify({ [A]: "https://127.0.0.1/hook" }),
      JSON.stringify({ [A]: "https://hooks.alpha.example:8443/hook" }),
      JSON.stringify({ [A]: "https://user:pass@hooks.alpha.example/" }),
      JSON.stringify({ "not-a-workspace": HOOK[A] }),
      JSON.stringify({ [A]: HOOK[A], [B]: 42 }),
    ]) {
      expect(readChangeNotifyConfig({ ...env(), TAVONEL_CHANGE_NOTIFY_ENDPOINTS: endpoints }), endpoints)
        .toEqual({ enabled: false, code: "CHANGE_NOTIFY_ENDPOINTS_INVALID" });
    }
    expect(readChangeNotifyConfig(env())).toMatchObject({ enabled: true });
  });

  it("is not set by vercel.json, and the cron it adds answers disabled without reading anything", async () => {
    const vercel = JSON.parse(readFileSync(resolve(import.meta.dirname, "../vercel.json"), "utf8")) as {
      env: Record<string, string>; crons: Array<{ path: string; schedule: string }>;
    };
    expect(Object.keys(vercel.env).filter((key) => key.startsWith("TAVONEL_CHANGE_NOTIFY"))).toEqual([]);
    expect(vercel.crons).toContainEqual({ path: "/api/internal/change-notify/run", schedule: "2-57/5 * * * *" });

    const { GET } = await import("../app/api/internal/change-notify/run/route");
    vi.stubEnv("FOUNDATION_WORKER_SECRET", "w".repeat(48));
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("TAVONEL_CHANGE_NOTIFY_ENABLED", "");
    const refused = await GET(new Request("https://tavonel.com/api/internal/change-notify/run"));
    expect(refused.status).toBe(401);
    const allowed = await GET(new Request("https://tavonel.com/api/internal/change-notify/run", { headers: { authorization: `Bearer ${"w".repeat(48)}` } }));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ code: "CHANGE_NOTIFY_DISABLED", enabled: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers 503 when switched on but unable to run, so a cron monitor sees the bad setup", async () => {
    const { GET } = await import("../app/api/internal/change-notify/run/route");
    const call = () => GET(new Request("https://tavonel.com/api/internal/change-notify/run", { headers: { authorization: `Bearer ${"w".repeat(48)}` } }));
    vi.stubEnv("FOUNDATION_WORKER_SECRET", "w".repeat(48));
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("TAVONEL_CHANGE_NOTIFY_ENABLED", "1");
    vi.stubEnv("TAVONEL_CHANGE_NOTIFY_SECRET", "");
    const missing = await call();
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ code: "CHANGE_NOTIFY_SECRET_MISSING", enabled: false });
    vi.stubEnv("TAVONEL_CHANGE_NOTIFY_SECRET", SECRET);
    vi.stubEnv("TAVONEL_CHANGE_NOTIFY_ENDPOINTS", "not json");
    const invalid = await call();
    expect(invalid.status).toBe(503);
    expect(await invalid.json()).toEqual({ code: "CHANGE_NOTIFY_ENDPOINTS_INVALID", enabled: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the shapes the database holds", () => {
  it("detects a change on digests in the form the migrations store, and publishes that form in /docs", async () => {
    expect(DB_SHAPE.candidate.test(DIGEST("c")) && DB_SHAPE.active.test(DIGEST("1"))).toBe(true);
    jobs = [job(A, COLLECTION_A, DIGEST("c"))];
    pointers = [{ workspace_key: A, collection_id: COLLECTION_A, manifest_digest: DIGEST("1") }];
    expect(await runChangeNotifyTurn(env())).toMatchObject({ code: "OK", enqueued: 1, delivered: 1 });
    expect(JSON.parse(sent[0]!.body)).toMatchObject({ candidateManifestDigest: DIGEST("c"), activeManifestDigest: DIGEST("1") });

    const table = findDocsSection("run-events")!.blocks.find((block) =>
      block.kind === "table" && block.rows.some(([field]) => field === "candidateManifestDigest")) as { rows: string[][] };
    const meaning = (field: string) => table.rows.find(([name]) => name === field)![1]!;
    expect(meaning("candidateManifestDigest")).toContain("sha256: followed by 64 hex characters");
    expect(meaning("activeManifestDigest")).toContain("same format");
  });

  it("names a row whose digest it cannot read instead of skipping it quietly", async () => {
    // A database whose shape moved away from the sender's (bare hex, for the sake of the test).
    enforceDbShape = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    jobs = [job(A, COLLECTION_A, "c".repeat(64)), job(B, COLLECTION_B, DIGEST("d"))];
    pointers = [{ workspace_key: B, collection_id: COLLECTION_B, manifest_digest: "1".repeat(64) }];
    const turn = await runChangeNotifyTurn(env());
    expect(turn).toMatchObject({ code: "CHANGE_NOTIFY_INCOMPLETE", enqueued: 0, errors: ["CHANGE_NOTIFY_JOB_ROW_INVALID", "CHANGE_NOTIFY_POINTER_ROW_INVALID"] });
    // B's active World is unreadable, so it is not announced as "nothing active" either.
    expect(sent).toEqual([]);
  });
});

describe("activation stays a human decision", () => {
  it("leaves the invariant as it is and gives the notifier no path to a World", () => {
    expect(activationPolicy.candidatePromotion).toEqual({ enabled: false, reason: "Activation is always an explicit human decision." });
    const source = readFileSync(resolve(import.meta.dirname, "change-notify.ts"), "utf8");
    expect([...source.matchAll(/^import [^\n]* from "([^"]+)";/gm)].map((match) => match[1])).toEqual(["node:crypto", "./safe-url", "./supabase-admin"]);
    // The only table it writes is its own outbox.
    expect([...source.matchAll(/\/rest\/v1\/([a-z_]+)/g)].map((match) => match[1]).sort())
      .toEqual(["foundation_active_worlds", "foundation_change_notifications", "foundation_compile_jobs"]);
  });
});

describe("detection and delivery", () => {
  it("sends one signed notification when a candidate differs from the active World, and the documented receiver accepts it", async () => {
    jobs = [job(A, COLLECTION_A, DIGEST("c"))];
    pointers = [{ workspace_key: A, collection_id: COLLECTION_A, manifest_digest: DIGEST("1") }];

    const turn = await runChangeNotifyTurn(env());
    expect(turn).toMatchObject({ code: "OK", enqueued: 1, delivered: 1, retrying: 0, dead: 0, errors: [] });
    expect(sent).toHaveLength(1);
    const [delivery] = sent;
    const event = verifyFromDocs(delivery!.headers, delivery!.body, workspaceSigningKey(SECRET, A));
    // The public DTO and nothing else: no attempt, state, error or schedule reaches a receiver.
    expect(event).toEqual({
      type: "world.candidate_awaiting_activation",
      deliveryId: changeDeliveryId(A, COLLECTION_A, DIGEST("c")),
      workspaceKey: A,
      collectionId: COLLECTION_A,
      candidateManifestDigest: DIGEST("c"),
      activeManifestDigest: DIGEST("1"),
      processedAt: jobs[0]!.updated_at,
      reviewRequired: false,
      activation: "explicit_human_decision",
    });
    expect(delivery!.body).toBe(canonicalJson(event));
    expect(delivery!.headers.get(CHANGE_NOTIFY_HEADERS.deliveryId)).toBe(event!.deliveryId);
    expect(outbox).toMatchObject([{ state: "delivered", attempt: 1, last_status: 200 }]);

    // The same change on the next turn is the same row: nothing new is enqueued or sent.
    expect(await runChangeNotifyTurn(env())).toMatchObject({ enqueued: 0, delivered: 0 });
    expect(sent).toHaveLength(1);
  });

  it("sends nothing when the candidate is the active World, and says null when nothing is active yet", async () => {
    jobs = [job(A, COLLECTION_A, DIGEST("c")), job(B, COLLECTION_B, DIGEST("d"), "review_required")];
    pointers = [{ workspace_key: A, collection_id: COLLECTION_A, manifest_digest: DIGEST("c") }];
    await runChangeNotifyTurn(env());
    expect(sent.map((delivery) => delivery.host)).toEqual(["hooks.beta.example"]);
    expect(JSON.parse(sent[0]!.body)).toMatchObject({ workspaceKey: B, activeManifestDigest: null, reviewRequired: true });
  });

  it("only the newest candidate per World is announced", async () => {
    jobs = [job(A, COLLECTION_A, DIGEST("e")), { ...job(A, COLLECTION_A, DIGEST("c")), updated_at: new Date(clock - 3_600_000).toISOString() }];
    await runChangeNotifyTurn(env());
    expect(sent.map((delivery) => JSON.parse(delivery.body).candidateManifestDigest)).toEqual([DIGEST("e")]);
  });
});

describe("tenant isolation", () => {
  it("sends each workspace only its own event, signed with its own key", async () => {
    jobs = [job(A, COLLECTION_A, DIGEST("c")), job(B, COLLECTION_B, DIGEST("d"))];
    await runChangeNotifyTurn(env());
    const byHost = Object.fromEntries(sent.map((delivery) => [delivery.host, delivery]));
    expect(JSON.parse(byHost["hooks.alpha.example"]!.body).workspaceKey).toBe(A);
    expect(JSON.parse(byHost["hooks.beta.example"]!.body).workspaceKey).toBe(B);
    const alpha = byHost["hooks.alpha.example"]!;
    expect(verifyFromDocs(alpha.headers, alpha.body, workspaceSigningKey(SECRET, A))).not.toBeNull();
    // B's key, or B's own signature replayed onto A's endpoint, verifies nothing of A's.
    expect(verifyFromDocs(alpha.headers, alpha.body, workspaceSigningKey(SECRET, B))).toBeNull();
    const beta = byHost["hooks.beta.example"]!;
    expect(verifyFromDocs(beta.headers, beta.body, workspaceSigningKey(SECRET, A))).toBeNull();
  });

  it("never reads or sends an unregistered workspace's changes", async () => {
    jobs = [job(A, COLLECTION_A, DIGEST("c")), job(B, COLLECTION_B, DIGEST("d"))];
    await runChangeNotifyTurn(env({ [A]: HOOK[A] }));
    const sweeps = storeReads.filter((read) => read.includes("foundation_compile_jobs"));
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]).toContain(`workspace_key=eq.${A}&`);
    expect(storeReads.join("\n")).not.toContain(B);
    expect(sent.map((delivery) => delivery.host)).toEqual(["hooks.alpha.example"]);
    expect(outbox.map((row) => row.workspace_key)).toEqual([A]);
  });

  it("reads each workspace on its own, so a busy workspace cannot push another's change out of the sweep", async () => {
    jobs = [
      ...Array.from({ length: 60 }, (_, index) => ({ ...job(A, COLLECTION_A, DIGEST("e")), updated_at: new Date(clock - 60_000 + index).toISOString() })),
      { ...job(B, COLLECTION_B, DIGEST("d")), updated_at: new Date(clock - 3_600_000).toISOString() },
    ];
    await runChangeNotifyTurn(env());
    expect(sent.map((delivery) => delivery.host).sort()).toEqual(["hooks.alpha.example", "hooks.beta.example"]);
  });

  it("buries a row whose workspace has no endpoint, or whose event names another workspace, without sending it anywhere", async () => {
    const stray = (workspace: string, eventWorkspace: string) => {
      const deliveryId = changeDeliveryId(workspace, COLLECTION_B, DIGEST(workspace === A ? "7" : "8"));
      outbox.push({ delivery_id: deliveryId, workspace_key: workspace, state: "pending", attempt: 0, created_at: new Date(clock).toISOString(),
        available_at: new Date(clock).toISOString(), event: { deliveryId, workspaceKey: eventWorkspace, type: "world.candidate_awaiting_activation" } });
    };
    stray(B, B); // B is not registered in this turn
    stray(A, B); // a row of A carrying B's event (the migration's identity check refuses this; the sender does too)
    const turn = await runChangeNotifyTurn(env({ [A]: HOOK[A] }));
    expect(sent).toEqual([]);
    expect(turn).toMatchObject({ dead: 2 });
    expect(outbox.map((row) => [row.workspace_key, row.state, row.last_error])).toEqual([
      [B, "dead", "CHANGE_NOTIFY_ENDPOINT_NOT_REGISTERED"],
      [A, "dead", "CHANGE_NOTIFY_ROW_MISMATCH"],
    ]);
  });
});

describe("failure paths", () => {
  beforeEach(() => {
    jobs = [job(A, COLLECTION_A, DIGEST("c"))];
  });

  it("retries an endpoint 5xx with the same delivery id and the same body, after the backoff and not before", async () => {
    receivers["hooks.alpha.example"] = () => new Response("unavailable", { status: 503 });
    expect(await runChangeNotifyTurn(env())).toMatchObject({ retrying: 1, delivered: 0 });
    expect(outbox[0]).toMatchObject({ state: "pending", attempt: 1, last_status: 503, last_error: "HTTP_503",
      available_at: new Date(clock + CHANGE_NOTIFY_RETRY_DELAYS_SECONDS[0] * 1_000).toISOString() });

    advance(CHANGE_NOTIFY_RETRY_DELAYS_SECONDS[0] - 1);
    await runChangeNotifyTurn(env());
    expect(sent).toHaveLength(1);

    advance(1);
    receivers["hooks.alpha.example"] = ok;
    expect(await runChangeNotifyTurn(env())).toMatchObject({ delivered: 1 });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body).toBe(sent[0]!.body);
    expect(sent[1]!.headers.get(CHANGE_NOTIFY_HEADERS.deliveryId)).toBe(sent[0]!.headers.get(CHANGE_NOTIFY_HEADERS.deliveryId));
    expect(sent[1]!.headers.get(CHANGE_NOTIFY_HEADERS.timestamp)).not.toBe(sent[0]!.headers.get(CHANGE_NOTIFY_HEADERS.timestamp));
    expect(outbox[0]).toMatchObject({ state: "delivered", attempt: 2 });
  });

  it("counts a timeout as a failed attempt, and every request is sent on a clock", async () => {
    receivers["hooks.alpha.example"] = () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); };
    expect(await runChangeNotifyTurn(env())).toMatchObject({ retrying: 1 });
    expect(sent[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(outbox[0]).toMatchObject({ state: "pending", attempt: 1, last_status: null, last_error: "EGRESS_REQUEST_FAILED" });
  });

  it("counts a 2xx with a body over 4 KiB as a failed attempt, as /docs tells the receiver", async () => {
    receivers["hooks.alpha.example"] = () => new Response("x".repeat(5_000), { status: 200 });
    expect(await runChangeNotifyTurn(env())).toMatchObject({ retrying: 1, delivered: 0 });
    expect(outbox[0]).toMatchObject({ state: "pending", attempt: 1, last_status: null, last_error: "EGRESS_RESPONSE_TOO_LARGE" });
    const retries = findDocsSection("run-events")!.blocks.find((block) => block.kind === "prose" && block.text.startsWith("Delivery is at least once.")) as { text: string };
    expect(retries.text).toContain("A response body over 4 KiB counts as a failure");
  });

  it("does not follow a redirect", async () => {
    receivers["hooks.alpha.example"] = () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } });
    await runChangeNotifyTurn(env());
    expect(sent.map((delivery) => delivery.host)).toEqual(["hooks.alpha.example"]);
    expect(outbox[0]).toMatchObject({ attempt: 1, last_error: "EGRESS_REDIRECT_REFUSED" });
  });

  it("is refused by the documented receiver when the signature does not match, and the refusal is retried", async () => {
    // A receiver holding the wrong key answers 401; that is a failed attempt, not a delivery.
    receivers["hooks.alpha.example"] = (delivery) =>
      verifyFromDocs(delivery.headers, delivery.body, workspaceSigningKey("x".repeat(40), A)) ? ok() : new Response("bad signature", { status: 401 });
    expect(await runChangeNotifyTurn(env())).toMatchObject({ retrying: 1, delivered: 0 });
    expect(outbox[0]).toMatchObject({ last_status: 401, last_error: "HTTP_401" });

    const [delivery] = sent;
    const key = workspaceSigningKey(SECRET, A);
    expect(verifyFromDocs(delivery!.headers, delivery!.body, key)).not.toBeNull();
    expect(verifyFromDocs(delivery!.headers, delivery!.body.replace(A, "pilot-other"), key), "tampered body").toBeNull();
    const without = new Headers(delivery!.headers);
    without.delete(CHANGE_NOTIFY_HEADERS.signature);
    expect(verifyFromDocs(without, delivery!.body, key), "no signature").toBeNull();
    const shifted = new Headers(delivery!.headers);
    shifted.set(CHANGE_NOTIFY_HEADERS.deliveryId, "dlv_" + "0".repeat(32));
    expect(verifyFromDocs(shifted, delivery!.body, key), "another delivery id").toBeNull();
    advance(301);
    expect(verifyFromDocs(delivery!.headers, delivery!.body, key), "replayed after the tolerance").toBeNull();
  });

  it("dead-letters after the last attempt with a receipt, and never sends it again", async () => {
    receivers["hooks.alpha.example"] = () => new Response("broken", { status: 500 });
    for (let attempt = 1; attempt <= CHANGE_NOTIFY_MAX_ATTEMPTS; attempt += 1) {
      await runChangeNotifyTurn(env());
      expect(sent).toHaveLength(attempt);
      advance(CHANGE_NOTIFY_RETRY_DELAYS_SECONDS[Math.min(attempt, CHANGE_NOTIFY_RETRY_DELAYS_SECONDS.length) - 1]);
    }
    expect(CHANGE_NOTIFY_MAX_ATTEMPTS).toBe(6);
    const [row] = outbox;
    expect(row).toMatchObject({ state: "dead", attempt: 6, last_status: 500, last_error: "HTTP_500" });
    expect(row!.dead_letter_receipt).toEqual({
      deliveryId: row!.delivery_id, workspaceKey: A, eventType: "world.candidate_awaiting_activation",
      attempts: 6, lastStatus: 500, lastError: "HTTP_500",
      bodySha256: nodeCrypto.createHash("sha256").update(sent[0]!.body).digest("hex"),
      enqueuedAt: row!.created_at, deadAt: row!.dead_at,
    });
    expect(new Set(sent.map((delivery) => delivery.body)).size).toBe(1);
    advance(86_400);
    await runChangeNotifyTurn(env());
    expect(sent).toHaveLength(6);
  });

  it("settles a last attempt a dead worker claimed without sending it again", async () => {
    await runChangeNotifyTurn(env());
    sent = [];
    Object.assign(outbox[0]!, { state: "pending", attempt: CHANGE_NOTIFY_MAX_ATTEMPTS, delivered_at: null, available_at: new Date(clock).toISOString() });
    expect(await runChangeNotifyTurn(env())).toMatchObject({ dead: 1 });
    expect(sent).toEqual([]);
    expect(outbox[0]).toMatchObject({ state: "dead", last_error: "CHANGE_NOTIFY_ATTEMPTS_EXHAUSTED" });
  });

  it("lets two overlapping turns send one attempt once", async () => {
    await Promise.all([runChangeNotifyTurn(env()), runChangeNotifyTurn(env())]);
    expect(sent).toHaveLength(1);
    expect(outbox).toMatchObject([{ state: "delivered", attempt: 1 }]);
  });

  it("names a store failure instead of reporting a quiet turn, and sends nothing", async () => {
    storeDown = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const turn = await runChangeNotifyTurn(env());
    expect(turn).toMatchObject({ code: "CHANGE_NOTIFY_INCOMPLETE", errors: ["CHANGE_NOTIFY_SWEEP_READ_FAILED", "CHANGE_NOTIFY_DUE_READ_FAILED"] });
    expect(sent).toEqual([]);
    expect(errors).toHaveBeenCalled();
    expect(await runChangeNotifyTurn({ ...env(), NEXT_PUBLIC_SUPABASE_URL: "" })).toMatchObject({ code: "CHANGE_NOTIFY_INCOMPLETE", errors: ["CHANGE_NOTIFY_STORE_NOT_CONFIGURED"] });
  });
});

describe("a receiver that follows the docs", () => {
  it("ignores a duplicate delivery: a retry after a lost acknowledgement is processed once", async () => {
    jobs = [job(A, COLLECTION_A, DIGEST("c"))];
    const seen = new Set<string>();
    let processed = 0;
    let loseAcknowledgement = true;
    receivers["hooks.alpha.example"] = (delivery) => {
      const event = verifyFromDocs(delivery.headers, delivery.body, workspaceSigningKey(SECRET, A));
      if (!event) return new Response("bad signature", { status: 401 });
      if (!seen.has(String(event.deliveryId))) {
        seen.add(String(event.deliveryId));
        processed += 1;
      }
      // The receiver stored it, then the connection dropped before TAVONEL read the 2xx.
      if (loseAcknowledgement) { loseAcknowledgement = false; throw new TypeError("fetch failed"); }
      return ok();
    };
    await runChangeNotifyTurn(env());
    advance(CHANGE_NOTIFY_RETRY_DELAYS_SECONDS[0]);
    await runChangeNotifyTurn(env());
    expect(sent).toHaveLength(2);
    expect(processed).toBe(1);
    expect(outbox[0]).toMatchObject({ state: "delivered", attempt: 2 });
  });
});
