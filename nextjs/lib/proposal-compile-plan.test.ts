import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  compile_plan (WO-AN-4, workorders/agent-native.md §4.2, §4.4). The spend tests run with the approval lineage
  as committed (off), and the first assertion says so: they cannot pass through a lineage production does not run.
*/

type Quote = { reservations: Record<string, unknown>[]; totalRechargeCredits: number; balanceRechargeCredits: number; overageCredits: number; balanceCredits: number };
type StoreCall = { method: string; path: string; body: Record<string, unknown> | null };

const postCompile = vi.fn<(request: Request) => Promise<Response>>();
const checkAccess = vi.fn<(workspaceKey: string, ids: string[], userId: string) => Promise<unknown>>();
const listObjects = vi.fn<(signer: unknown, workspaceKey: string) => Promise<unknown>>();
const readSigner = vi.fn<() => unknown>();
const canAdmit = vi.fn<(workspaceKey: string, scope: string) => Promise<boolean>>();
const readScope = vi.fn<(workspaceKey: string, ids: readonly string[]) => Promise<unknown>>();
const trialCapacity = vi.fn<(workspaceKey: string, userId: string, key?: string) => Promise<unknown>>();
const revalidate = vi.fn<(request: Request, principal: unknown) => Promise<unknown>>();
let store: StoreCall[];
let quote: Quote | "down";
let rows: Map<string, Record<string, unknown>>;
let storeThrows: unknown = null;

vi.mock("@/app/api/compile-jobs/route", () => ({ POST: postCompile }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccessForViewer: checkAccess }));
vi.mock("@/lib/r2-objects", () => ({ listImmutableWorkspaceObjects: listObjects, putWorkspaceCollectionCandidate: vi.fn() }));
vi.mock("@/lib/r2-synthetic-canary", () => ({ readR2SignerEnv: readSigner }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: canAdmit }));
vi.mock("@/lib/customer-source-scope", () => ({ readCustomerSourceScope: readScope }));
vi.mock("@/lib/self-service-trial", () => ({ checkTrialCompileCapacity: trialCapacity }));
vi.mock("@/lib/developer-auth", () => ({ requireFoundationSession: vi.fn(), revalidateFoundationSession: revalidate }));
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({}),
  supabaseAdminRequest: async (_config: unknown, path: string, init: { method?: string; body?: string } = {}) => {
    if (storeThrows !== null) throw storeThrows;
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    store.push({ method: init.method ?? "GET", path, body });
    const name = path.replace("/rest/v1/rpc/", "");
    if (name === "quote_foundation_compile_recharge") {
      if (quote === "down") return new Response(JSON.stringify({ message: "statement timeout" }), { status: 500 });
      return new Response(JSON.stringify(quote), { status: 200 });
    }
    if (name === "create_world_change_proposal") {
      const row = { ...baseRow, proposal_id: "00000000-0000-4000-8000-0000000000c1", input: body!.p_input, expected_manifest_digest: body!.p_expected_manifest_digest };
      rows.set(row.proposal_id, row);
      return new Response(JSON.stringify({ proposal: row, replayed: false }), { status: 200 });
    }
    if (name === "decide_world_change_proposal") {
      const row = rows.get(body!.p_proposal_id as string)!;
      const state = body!.p_current_manifest_digest === row.expected_manifest_digest ? "confirmed" : "stale";
      Object.assign(row, { state, decided_at: new Date().toISOString(), decided_by: body!.p_decided_by });
      return new Response(JSON.stringify(row), { status: 200 });
    }
    if (name === "record_world_change_proposal_outcome") {
      const row = rows.get(body!.p_proposal_id as string)!;
      Object.assign(row, { state: body!.p_outcome, receipt: body!.p_receipt });
      return new Response(JSON.stringify(row), { status: 200 });
    }
    return new Response(JSON.stringify({ message: `unexpected ${path}` }), { status: 500 });
  },
}));

const { INTAKE_APPROVAL_ROLLOUT_ENABLED } = await import("./intake-approval-rollout");
const plan = await import("./proposal-compile-plan");
const proposals = await import("./change-proposals");
const { immutableWorkspacePrefix } = await import("./immutable-keys");

const WS = "pilot-a";
const PERSON = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
const CONFIRMER = "7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b";
const GRANT = "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a";
const DOC_A = "0a000000-0000-4000-8000-00000000000a";
const DOC_B = "0b000000-0000-4000-8000-00000000000b";
const doc = (n: number) => `0c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const agent = { kind: "agent", workspaceKey: WS, userId: PERSON, authorizationRevision: 3, grantId: GRANT, keyId: "k" } as const;
const SIGNER = { bucket: "tavonel-saas-foundation-quarantine" };
const versionsOf = new Map<string, string[]>();

const baseRow = {
  proposal_id: "", workspace_key: WS, collection_id: null, action_type: "compile_plan", input: null, input_sha256: `sha256:${"9".repeat(64)}`,
  evidence_ids: [], state: "proposed", expires_at: "2099-01-01T00:00:00Z", created_at: "2026-11-17T00:00:00Z", decided_at: null,
  binding_kind: "source_inventory", principal_kind: "session", principal_id: PERSON, agent_grant_id: null, decided_by: null,
  expected_manifest_digest: "", idempotency_key: "session-key-0001", receipt: null, agent_client_label: null, agent_grantor_email: null,
};

const reservation = (id: string, documentId: string, fields: Partial<Record<string, unknown>> = {}) => ({
  reservationId: id, documentId, billingSource: "paid", reversedCredits: 10, settledCredits: 10, reservedCredits: 10, ...fields,
});
const quoteOf = (fields: Partial<Quote> = {}): Quote => ({
  reservations: [reservation("r-1", DOC_A)], totalRechargeCredits: 10, balanceRechargeCredits: 10, overageCredits: 0, balanceCredits: 100, ...fields,
});

/** The workspace inventory: one sanitized version per document unless the test adds more. */
function inventory() {
  const prefix = immutableWorkspacePrefix(WS);
  return [...versionsOf].flatMap(([id, versions]) => versions.map((version, index) => ({
    key: `${prefix}${id}/${version}/sanitized.pdf`, size: 1, lastModified: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
  })));
}

const writes = () => store.filter((call) => call.method !== "GET" && !["quote_foundation_compile_recharge"].includes(call.path.replace("/rest/v1/rpc/", "")));
const prepare = (documentIds: unknown, actor: Parameters<typeof plan.compilePlanExecutor.prepare>[0] = agent) =>
  plan.compilePlanExecutor.prepare(actor, { documentIds }, []);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  store = [];
  storeThrows = null;
  rows = new Map();
  quote = quoteOf();
  versionsOf.clear();
  versionsOf.set(DOC_A, ["a".repeat(32)]);
  versionsOf.set(DOC_B, ["b".repeat(32)]);
  checkAccess.mockResolvedValue({ ok: true });
  readSigner.mockReturnValue(SIGNER);
  listObjects.mockImplementation(async () => ({ ok: true, objects: inventory() }));
  canAdmit.mockResolvedValue(true);
  readScope.mockResolvedValue({ ok: true, scope: "direct_upload" });
  trialCapacity.mockResolvedValue({ ok: true, allowed: true });
  revalidate.mockResolvedValue({ ok: true });
  postCompile.mockImplementation(async () => Response.json({ code: "COMPILE_JOB_ACCEPTED", jobId: `cjob-${"1".repeat(32)}`, state: "queued" }, { status: 202 }));
});
afterEach(() => vi.unstubAllEnvs());

it("runs with the approval lineage off, as committed", () => {
  expect(INTAKE_APPROVAL_ROLLOUT_ENABLED).toBe(false);
});

describe("stored input", () => {
  const good = { documentIds: [DOC_A, DOC_B], quote: { rechargeCredits: 1, balanceRechargeCredits: 1, overageCredits: 0 } };
  it("parses the sorted canonical set with its quote", () => {
    expect(plan.parseCompilePlanInput(good)).toEqual(good);
  });
  it.each([
    ["an unsorted set", { ...good, documentIds: [DOC_B, DOC_A] }],
    ["a duplicate", { ...good, documentIds: [DOC_A, DOC_A] }],
    ["an empty set", { ...good, documentIds: [] }],
    ["an upper-case id", { ...good, documentIds: [DOC_A.toUpperCase()] }],
    ["an unknown key", { ...good, collectionId: null }],
    ["a quote without its overage", { ...good, quote: { rechargeCredits: 1, balanceRechargeCredits: 1 } }],
    ["a negative credit", { ...good, quote: { ...good.quote, overageCredits: -1 } }],
    ["a fractional credit", { ...good, quote: { ...good.quote, rechargeCredits: 1.5 } }],
  ])("refuses %s", (_name, raw) => {
    expect(plan.parseCompilePlanInput(raw)).toBeNull();
  });
});

describe("prepare: the creation dry-run", () => {
  it("previews exactly the §7 shape with the set, parts and the server quote, and binds versions and quote", async () => {
    quote = quoteOf({ totalRechargeCredits: 30, balanceRechargeCredits: 12, overageCredits: 18, balanceCredits: 40 });
    const prepared = await prepare([DOC_B, DOC_A]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.collectionId).toBeNull();
    expect(prepared.bindingDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.compilePlanExecutor.previewOf(prepared.input)).toEqual({
      documentIds: [DOC_A, DOC_B], documentsTotal: 2, corpus: false, parts: 1, quote: { rechargeCredits: 30, balanceRechargeCredits: 12, overageCredits: 18 },
    });
    expect(plan.parseCompilePlanInput(prepared.input)).toEqual(prepared.input);
  });

  it("a corpus-sized set previews as a corpus with its parts", async () => {
    const ids = Array.from({ length: 30 }, (_, n) => doc(n));
    for (const id of ids) versionsOf.set(id, ["c".repeat(32)]);
    const prepared = await prepare(ids);
    expect(prepared.ok && plan.compilePlanExecutor.previewOf(prepared.input)).toMatchObject({ documentsTotal: 30, corpus: true, parts: 3 });
  });

  it("I-1: writes nothing — the quote is the only store call, no compile, no PUT", async () => {
    expect((await prepare([DOC_A])).ok).toBe(true);
    expect(postCompile).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
    expect(store.map((call) => call.path)).toEqual(["/rest/v1/rpc/quote_foundation_compile_recharge"]);
  });

  it.each([
    ["denied", { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" }],
    ["unavailable", { ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" }],
  ])("access %s is the same not-found, checked before anything else", async (_name, answer) => {
    checkAccess.mockResolvedValue(answer);
    expect(await prepare([DOC_A])).toEqual({ ok: false, code: "PROPOSAL_TARGET_NOT_FOUND", status: 404 });
    expect(listObjects).not.toHaveBeenCalled();
    expect(store).toEqual([]);
  });

  it("access is asked for the whole set, as the proposer", async () => {
    await prepare([DOC_B, DOC_A]);
    expect(checkAccess).toHaveBeenCalledWith(WS, [DOC_A, DOC_B], PERSON);
  });

  it.each([
    ["absent from the inventory", () => versionsOf.delete(DOC_B)],
    ["with an ambiguous current version (two versions, same observation time)", () => {
      versionsOf.set(DOC_B, ["b".repeat(32), "e".repeat(32)]);
      listObjects.mockImplementation(async () => ({ ok: true, objects: inventory().map((object) => ({ ...object, lastModified: "2026-01-01T00:00:00.000Z" })) }));
    }],
  ])("a document %s is not found and nothing is quoted", async (_name, arrange) => {
    arrange();
    expect(await prepare([DOC_A, DOC_B])).toEqual({ ok: false, code: "PROPOSAL_TARGET_NOT_FOUND", status: 404 });
    expect(store).toEqual([]);
  });

  it.each([
    ["no signer", () => readSigner.mockReturnValue(null)],
    ["a listing that fails", () => listObjects.mockResolvedValue({ ok: false, code: "LIST_FAILED" })],
  ])("an inventory with %s fails closed with 503", async (_name, arrange) => {
    arrange();
    expect(await prepare([DOC_A])).toEqual({ ok: false, code: "PROPOSAL_PRECONDITION_UNAVAILABLE", status: 503 });
  });

  it.each([
    ["a duplicate", [DOC_A, DOC_A]],
    ["an empty set", []],
    ["a non-UUID", ["not-a-uuid"]],
    ["a body over the compile route's 4,096 bytes", Array.from({ length: 105 }, (_, n) => doc(n))],
    ["a string", DOC_A],
  ])("%s is refused before any call", async (_name, ids) => {
    expect(await prepare(ids)).toEqual({ ok: false, code: "PROPOSAL_REQUEST_INVALID", status: 400 });
    expect(checkAccess).not.toHaveBeenCalled();
  });

  it("refuses any key but documentIds", async () => {
    expect(await plan.compilePlanExecutor.prepare(agent, { documentIds: [DOC_A], collectionId: "x" }, [])).toMatchObject({ code: "PROPOSAL_REQUEST_INVALID" });
  });

  it("customer-data admission and trial capacity refuse as the web compile does", async () => {
    canAdmit.mockResolvedValueOnce(false);
    expect(await prepare([DOC_A])).toEqual({ ok: false, code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", status: 403 });
    trialCapacity.mockResolvedValueOnce({ ok: true, allowed: false });
    expect(await prepare([DOC_A], { ...agent, accessSource: "trial" })).toEqual({ ok: false, code: "TRIAL_WORLD_LIMIT_REACHED", status: 402 });
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    readScope.mockResolvedValueOnce({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" });
    expect(await prepare([DOC_A])).toEqual({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE", status: 503 });
  });
});

describe("I-7: spend bounded by the quote", () => {
  it("the balance part over the balance refuses creation with 409, and no proposal row is created", async () => {
    quote = quoteOf({ totalRechargeCredits: 50, balanceRechargeCredits: 41, overageCredits: 9, balanceCredits: 40 });
    const created = await proposals.createProposal(agent, { actionType: "compile_plan", raw: { documentIds: [DOC_A] }, evidenceIds: [], clientKey: "client-key-01", toolName: "propose_compile" });
    expect(created).toEqual({ ok: false, code: "PROPOSAL_QUOTE_OVER_BALANCE", status: 409 });
    expect(store.map((call) => call.path)).not.toContain("/rest/v1/rpc/create_world_change_proposal");
  });

  it("a read settled above its hold shows overage with an ample balance, and creation is not refused", async () => {
    // The whole re-charge exceeds the balance, but the part the balance pays does not: overage is shown, not refused.
    quote = quoteOf({ reservations: [reservation("r-1", DOC_A, { reversedCredits: 100, settledCredits: 10, reservedCredits: 10 })],
      totalRechargeCredits: 100, balanceRechargeCredits: 10, overageCredits: 90, balanceCredits: 50 });
    const created = await proposals.createProposal(agent, { actionType: "compile_plan", raw: { documentIds: [DOC_A] }, evidenceIds: [], clientKey: "client-key-02", toolName: "propose_compile" });
    expect(created.ok).toBe(true);
    const preview = created.ok ? plan.compilePlanPreview(plan.parseCompilePlanInput(created.row.input)!) : null;
    expect(preview?.quote).toEqual({ rechargeCredits: 100, balanceRechargeCredits: 10, overageCredits: 90 });
  });

  it("the quote is an upper bound: the preview carries the store's figures, never a figure the TS lowered or raised", async () => {
    // A twin reservation of one document: the trigger's twin rule can only lower the charge; the quote ignores it.
    quote = quoteOf({ reservations: [reservation("r-1", DOC_A), reservation("r-2", DOC_A)], totalRechargeCredits: 20, balanceRechargeCredits: 20, overageCredits: 0 });
    const prepared = await prepare([DOC_A]);
    expect(prepared.ok && prepared.input.quote).toEqual({ rechargeCredits: 20, balanceRechargeCredits: 20, overageCredits: 0 });
  });

  it.each([
    ["a quote RPC that fails", () => { quote = "down"; }],
    ["a malformed quote", () => { quote = { ...quoteOf(), balanceCredits: -1 }; }],
    ["a malformed reservation", () => { quote = quoteOf({ reservations: [{ reservationId: "r-1" }] }); }],
  ])("%s fails closed at creation (503) with no row", async (_name, arrange) => {
    arrange();
    expect(await prepare([DOC_A])).toEqual({ ok: false, code: "PROPOSAL_PRECONDITION_UNAVAILABLE", status: 503 });
  });
});

describe("the binding (I-6) and the preview digest", () => {
  const input = async () => {
    const prepared = await prepare([DOC_A, DOC_B]);
    if (!prepared.ok) throw new Error("prepare failed");
    return prepared;
  };
  const current = async (prepared: Awaited<ReturnType<typeof input>>) => {
    const binding = await plan.compilePlanExecutor.currentBinding(agent, baseRow as never, prepared.input);
    if (!binding.ok) throw new Error(binding.code);
    return binding.digest;
  };

  it("an unchanged world binds the same digest", async () => {
    const prepared = await input();
    expect(await current(prepared)).toBe(prepared.bindingDigest);
  });

  it.each([
    ["a source replaced by a newer version", () => versionsOf.set(DOC_B, ["b".repeat(32), "f".repeat(32)])],
    ["a source removed", () => versionsOf.delete(DOC_A)],
    ["a new refund of one of its reads", () => { quote = quoteOf({ reservations: [reservation("r-1", DOC_A), reservation("r-9", DOC_B)] }); }],
    ["a read settled since (the split moved)", () => { quote = quoteOf({ reservations: [reservation("r-1", DOC_A, { settledCredits: 4 })] }); }],
    ["a refund re-charged since", () => { quote = quoteOf({ reservations: [] }); }],
  ])("%s changes the binding, so the decision is stale", async (_name, arrange) => {
    const prepared = await input();
    arrange();
    expect(await current(prepared)).not.toBe(prepared.bindingDigest);
  });

  it("a quote that cannot be read fails closed (503), never a binding", async () => {
    const prepared = await input();
    quote = "down";
    expect(await plan.compilePlanExecutor.currentBinding(agent, baseRow as never, prepared.input)).toEqual({ ok: false, code: "PROPOSAL_PRECONDITION_UNAVAILABLE", status: 503 });
  });

  it("preconditions re-quote: over the balance is 409, an unreadable quote is 503, never a pass", async () => {
    const prepared = await input();
    const check = () => plan.compilePlanExecutor.preconditions(agent, baseRow as never, prepared.input);
    expect(await check()).toBeNull();
    quote = quoteOf({ balanceRechargeCredits: 101, balanceCredits: 100 });
    expect(await check()).toEqual({ ok: false, code: "PROPOSAL_QUOTE_OVER_BALANCE", status: 409 });
    quote = "down";
    expect(await check()).toEqual({ ok: false, code: "PROPOSAL_PRECONDITION_UNAVAILABLE", status: 503 });
  });

  it("the preview contains the document set, so the preview digest changes when one id changes", async () => {
    const one = { documentIds: [DOC_A, DOC_B], quote: { rechargeCredits: 0, balanceRechargeCredits: 0, overageCredits: 0 } };
    const other = { ...one, documentIds: [DOC_A, doc(7)] };
    const digest = (value: typeof one) => proposals.proposalPreviewDigest("00000000-0000-4000-8000-000000000001", "compile_plan", plan.compilePlanExecutor.previewOf(value));
    expect(plan.compilePlanPreview(one).documentIds).toEqual([DOC_A, DOC_B]);
    expect(digest(other)).not.toBe(digest(one));
  });
});

/*
  The class of failure, not one input: every reader the dry-run, the binding and the preconditions reuse is
  made to throw in turn (an Error, a TypeError, a non-Error value). Each member must answer a coded refusal —
  never reject, never succeed — so the decision path can neither crash nor decide on a reader that failed.
*/
describe("fail closed: any reader that throws is a refusal", () => {
  const thrown = [new Error("boom"), new TypeError("x is not a function"), "a string"];
  const readers: Array<[string, (value: unknown) => void]> = [
    ["the access check", (value) => checkAccess.mockImplementation(async () => { throw value; })],
    ["the R2 signer", (value) => readSigner.mockImplementation(() => { throw value; })],
    ["the inventory listing", (value) => listObjects.mockImplementation(async () => { throw value; })],
    ["the customer-data admission", (value) => canAdmit.mockImplementation(async () => { throw value; })],
    ["the source scope", (value) => readScope.mockImplementation(async () => { throw value; })],
    ["the trial capacity", (value) => trialCapacity.mockImplementation(async () => { throw value; })],
    ["the quote's store", (value) => { storeThrows = value; }],
    ["the quote's body", () => { quote = { get reservations(): never { throw new Error("getter"); } } as never; }],
  ];
  const cases = readers.flatMap(([name, arrange]) => thrown.map((value) => [`${name} (${String(value)})`, () => arrange(value)] as const));

  it.each(cases)("%s: prepare, currentBinding and preconditions answer a refusal", async (_name, arrange) => {
    const ready = await prepare([DOC_A]);
    if (!ready.ok) throw new Error("setup");
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    arrange();
    const trial = { ...agent, accessSource: "trial" } as const;
    const prepared = await plan.compilePlanExecutor.prepare(trial, { documentIds: [DOC_A] }, []);
    expect(prepared).toMatchObject({ ok: false });
    expect((prepared as { status: number }).status).toBeGreaterThanOrEqual(400);
    for (const answer of [
      await plan.compilePlanExecutor.currentBinding(trial, baseRow as never, ready.input),
      await plan.compilePlanExecutor.preconditions(trial, baseRow as never, ready.input),
    ]) {
      if (answer !== null && !answer.ok) expect(answer.status).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("run: the existing web compile, in process, as the confirming person", () => {
  const input = { documentIds: [DOC_A, DOC_B], quote: { rechargeCredits: 0, balanceRechargeCredits: 0, overageCredits: 0 } };
  const confirmRequest = () => new Request("https://tavonel.com/api/proposals/x/decision", { method: "POST", headers: { authorization: "Bearer confirmer-session" } });
  const agentRow = { ...baseRow, principal_kind: "agent", principal_id: PERSON, agent_grant_id: GRANT, state: "confirmed", decided_by: CONFIRMER };
  const run = (request = confirmRequest()) => plan.compilePlanExecutor.run({ request, actor: { kind: "session", workspaceKey: WS, userId: CONFIRMER, authorizationRevision: 3 }, row: agentRow as never, input });

  it("carries the confirming request's Authorization (not the proposer's) and exactly the stored set", async () => {
    expect(await run()).toEqual({ ok: true, jobId: `cjob-${"1".repeat(32)}` });
    const sent = postCompile.mock.calls[0]![0];
    expect(sent.method).toBe("POST");
    expect(new URL(sent.url).pathname).toBe("/api/compile-jobs");
    expect(sent.headers.get("authorization")).toBe("Bearer confirmer-session");
    expect(await sent.json()).toEqual({ documentIds: [DOC_A, DOC_B] });
  });

  it("a re-run (resume) sends the identical request, so the enqueue key returns the same job", async () => {
    await run();
    await run();
    const [first, second] = postCompile.mock.calls.map((call) => call[0]);
    expect(await second!.text()).toBe(await first!.text());
    expect(second!.headers.get("authorization")).toBe(first!.headers.get("authorization"));
  });

  it("an incomplete corpus is executed, with its reason in the result", async () => {
    postCompile.mockResolvedValueOnce(Response.json({ code: "COMPILE_CORPUS_ACCEPTED", corpusId: `corpus-${"2".repeat(32)}`, incompleteReason: "COMPILE_JOB_WORKSPACE_LIMIT_REACHED" }, { status: 202 }));
    const result = await run();
    expect(result).toEqual({ ok: true, corpusId: `corpus-${"2".repeat(32)}`, incompleteReason: "COMPILE_JOB_WORKSPACE_LIMIT_REACHED" });
    expect(result.ok && plan.compilePlanExecutor.resultRef(result)).toEqual({ corpusId: `corpus-${"2".repeat(32)}`, incompleteReason: "COMPILE_JOB_WORKSPACE_LIMIT_REACHED" });
  });

  it.each([
    [403, { code: "CONNECTOR_SOURCE_ACCESS_DENIED" }, { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED", status: 403 }],
    [402, { code: "TRIAL_WORLD_LIMIT_REACHED" }, { ok: false, code: "TRIAL_WORLD_LIMIT_REACHED", status: 402 }],
    [401, null, { ok: false, code: "PROPOSAL_EXECUTOR_FAILED", status: 401 }],
    [202, { code: "COMPILE_JOB_ACCEPTED", jobId: "nope" }, { ok: false, code: "PROPOSAL_EXECUTOR_RESPONSE_INVALID", status: 502 }],
    [200, { code: "OK" }, { ok: false, code: "OK", status: 502 }],
  ])("a %s from the route is a failure with the route's code", async (status, body, expected) => {
    postCompile.mockResolvedValueOnce(new Response(body === null ? "not json" : JSON.stringify(body), { status }));
    expect(await run()).toEqual(expected);
  });

  it("no undo: a compile is not undoable in v1", () => {
    expect(plan.compilePlanExecutor.undo).toBeUndefined();
  });
});

describe("decision path with the real executor", () => {
  const principal = { kind: "session", workspaceKey: WS, userId: CONFIRMER, authorizationRevision: 3 } as never;
  const confirmRequest = () => new Request("https://tavonel.com/api/proposals/x/decision", { method: "POST", headers: { authorization: "Bearer confirmer-session" } });
  async function proposed() {
    const created = await proposals.createProposal({ kind: "session", workspaceKey: WS, userId: PERSON, authorizationRevision: 3 },
      { actionType: "compile_plan", raw: { documentIds: [DOC_A] }, evidenceIds: [], clientKey: "session-key-0001" });
    if (!created.ok) throw new Error(created.code);
    return created.row as Parameters<typeof proposals.decideProposal>[2];
  }
  const digestOf = (row: Parameters<typeof proposals.decideProposal>[2]) =>
    proposals.proposalPreviewDigest(row.proposal_id, "compile_plan", plan.compilePlanExecutor.previewOf(plan.parseCompilePlanInput(row.input)!));
  const decideCalls = () => store.filter((call) => call.path.endsWith("/decide_world_change_proposal")).length;

  it("confirmed and executed: one compile, outcome recorded with the job", async () => {
    const row = await proposed();
    const answer = await proposals.decideProposal(confirmRequest(), principal, row, { decision: "confirm", previewDigest: digestOf(row) });
    expect(answer.ok && answer.proposal.state).toBe("executed");
    expect(postCompile).toHaveBeenCalledTimes(1);
    expect(rows.get(row.proposal_id)?.receipt).toMatchObject({ result: { ok: true, jobId: `cjob-${"1".repeat(32)}` } });
  });

  it("over the balance at confirmation: 409, nothing decided, the row stays proposed", async () => {
    const row = await proposed();
    quote = quoteOf({ balanceRechargeCredits: 101, balanceCredits: 100 });
    expect(await proposals.decideProposal(confirmRequest(), principal, row, { decision: "confirm", previewDigest: digestOf(row) }))
      .toEqual({ ok: false, code: "PROPOSAL_QUOTE_OVER_BALANCE", status: 409 });
    expect(decideCalls()).toBe(0);
    expect(rows.get(row.proposal_id)?.state).toBe("proposed");
    expect(postCompile).not.toHaveBeenCalled();
  });

  it("the quote RPC down at confirmation: 503, nothing decided", async () => {
    const row = await proposed();
    quote = "down";
    expect(await proposals.decideProposal(confirmRequest(), principal, row, { decision: "confirm", previewDigest: digestOf(row) }))
      .toEqual({ ok: false, code: "PROPOSAL_PRECONDITION_UNAVAILABLE", status: 503 });
    expect(decideCalls()).toBe(0);
  });

  it("a new refund of one of its reads since the proposal: stale, no compile", async () => {
    const row = await proposed();
    quote = quoteOf({ reservations: [reservation("r-1", DOC_A), reservation("r-2", DOC_A)] });
    const answer = await proposals.decideProposal(confirmRequest(), principal, row, { decision: "confirm", previewDigest: digestOf(row) });
    expect(answer.ok && answer.proposal.state).toBe("stale");
    expect(postCompile).not.toHaveBeenCalled();
  });

  it("a source version changed since the proposal: stale, no compile", async () => {
    const row = await proposed();
    versionsOf.set(DOC_A, ["a".repeat(32), "d".repeat(32)]);
    const answer = await proposals.decideProposal(confirmRequest(), principal, row, { decision: "confirm", previewDigest: digestOf(row) });
    expect(answer.ok && answer.proposal.state).toBe("stale");
    expect(postCompile).not.toHaveBeenCalled();
  });
});
