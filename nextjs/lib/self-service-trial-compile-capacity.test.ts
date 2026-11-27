import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-TRIAL-P0. A free evaluation whose compile settled `review_required` was stuck: promote refused
  it and this check counted it as the evaluation's one World. These pin the new count against the
  promote route's own predicate, the attempt bound, and the fail-closed reads.
*/

const { trial, admin, signer, activeWorlds, candidate, promotable } = vi.hoisted(() => ({
  trial: vi.fn(),
  admin: vi.fn(),
  signer: vi.fn(),
  activeWorlds: vi.fn(),
  candidate: vi.fn(),
  promotable: vi.fn(),
}));

vi.mock("./account-grants", () => ({ getFoundationSelfServiceTrial: trial }));
vi.mock("./supabase-admin", () => ({ readSupabaseAdminConfig: () => ({ url: "https://db.test", key: "k" }), supabaseAdminRequest: admin }));
vi.mock("./r2-synthetic-canary", () => ({ readR2SignerEnv: signer }));
vi.mock("./world-store", () => ({ ACTIVE_WORLD_PAGE_MAX: 50, listFoundationActiveWorlds: activeWorlds }));
vi.mock("./r2-objects", () => ({ getWorkspaceCollectionCandidate: candidate }));
vi.mock("./collection-download", () => ({ validatePromotableCollectionArtifact: promotable }));

const { checkTrialCompileCapacity, TRIAL_NON_PROMOTABLE_COMPILE_LIMIT } = await import("./self-service-trial");

const WORKSPACE = "pilot-trialp0";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const collection = (n: number) => `collection-${String(n).padStart(32, "0")}`;
const digest = (n: number) => `sha256:${String(n).padStart(64, "0")}`;

type Row = { state: string; collection_id: string | null; candidate_manifest_digest: string | null };
const review = (n: number): Row => ({ state: "review_required", collection_id: collection(n), candidate_manifest_digest: digest(n) });
const ready = (n: number): Row => ({ state: "ready", collection_id: collection(n), candidate_manifest_digest: digest(n) });
const running = (): Row => ({ state: "reading", collection_id: null, candidate_manifest_digest: null });

let jobs: Row[] | "fail" | "garbage";
let worldLimit: number;
/** Candidate verdicts the stored artifacts carry, by collection id. */
let verdict: Map<string, boolean>;

beforeEach(() => {
  jobs = [];
  worldLimit = 1;
  verdict = new Map();
  trial.mockReset().mockResolvedValue({ ok: true, trial: { status: "trialing", expiresAt: "2999-01-01T00:00:00Z" } });
  admin.mockReset().mockImplementation(async (_config: unknown, path: string) => {
    if (path.startsWith("/rest/v1/foundation_trial_policy")) return Response.json([{ world_limit: worldLimit }]);
    if (path.startsWith("/rest/v1/foundation_compile_jobs")) {
      const query = new URLSearchParams(path.split("?")[1]);
      if (query.has("idempotency_key")) return Response.json([]);
      if (jobs === "fail") return new Response("{}", { status: 500 });
      if (jobs === "garbage") return new Response("not json", { status: 200 });
      return Response.json(jobs);
    }
    throw new Error(`unexpected ${path}`);
  });
  signer.mockReset().mockReturnValue({ bucket: "b" });
  activeWorlds.mockReset().mockResolvedValue({ ok: true, worlds: [], nextCursor: null });
  candidate.mockReset().mockImplementation(async (_s: unknown, _w: string, key: string) => {
    const id = /collections\/(collection-[0-9a-f]{32})\//.exec(key)?.[1] ?? "";
    return { ok: true, json: { id, promotable: verdict.get(id) ?? false } };
  });
  promotable.mockReset().mockImplementation((json: { promotable: boolean }) => (json.promotable ? json : null));
});

const check = () => checkTrialCompileCapacity(WORKSPACE, USER, "a".repeat(64));

describe("trial compile capacity: a compile nobody can activate is not the evaluation's World", () => {
  it("allows the first compile", async () => {
    expect(await check()).toEqual({ ok: true, allowed: true });
  });

  it("asks the store for live jobs only, in a bounded page", async () => {
    await check();
    const path = admin.mock.calls.map((call) => call[1] as string).find((p) => p.includes("state="))!;
    const query = new URLSearchParams(path.split("?")[1]);
    expect(query.get("state")).toBe("not.in.(failed,cancelled)");
    expect(query.get("limit")).toBe("20");
  });

  it("allows a second compile after one review_required, and refuses the third with its own code (attempt bound 1st/2nd/3rd)", async () => {
    expect(TRIAL_NON_PROMOTABLE_COMPILE_LIMIT).toBe(2);
    jobs = [];
    expect(await check()).toEqual({ ok: true, allowed: true });
    jobs = [review(1)];
    expect(await check()).toEqual({ ok: true, allowed: true });
    // The verdict came from the promote route's predicate, applied to this job's own candidate.
    expect(promotable).toHaveBeenCalledWith({ id: collection(1), promotable: false }, collection(1));
    expect(candidate.mock.calls[0]![2]).toBe(
      `immutable/${WORKSPACE}/${WORKSPACE}/collections/${collection(1)}/${"0".repeat(63)}1/candidate-world.json`,
    );
    jobs = [review(1), review(2)];
    expect(await check()).toEqual({ ok: true, allowed: false, code: "TRIAL_COMPILE_ATTEMPTS_EXHAUSTED" });
  });

  it("review_required then a successful compile counts exactly one World", async () => {
    jobs = [review(1), ready(2)];
    expect(await check()).toEqual({ ok: true, allowed: false, code: "TRIAL_WORLD_LIMIT_REACHED" });
    // The World counted is the ready one: with a limit of two, one slot is still free.
    worldLimit = 2;
    expect(await check()).toEqual({ ok: true, allowed: true });
  });

  it("an activated World still counts, and reads no candidate to say so", async () => {
    jobs = [ready(1)];
    expect(await check()).toEqual({ ok: true, allowed: false, code: "TRIAL_WORLD_LIMIT_REACHED" });
    expect(candidate).not.toHaveBeenCalled();
    expect(activeWorlds).not.toHaveBeenCalled();
  });

  it("a review_required job whose collection is now an active World counts as the World", async () => {
    jobs = [review(1)];
    activeWorlds.mockResolvedValueOnce({ ok: true, worlds: [{ collectionId: collection(1) }], nextCursor: null });
    expect(await check()).toEqual({ ok: true, allowed: false, code: "TRIAL_WORLD_LIMIT_REACHED" });
    expect(candidate).not.toHaveBeenCalled();
  });

  it("a review_required job whose candidate the predicate accepts counts as the World", async () => {
    jobs = [review(1)];
    verdict.set(collection(1), true);
    expect(await check()).toEqual({ ok: true, allowed: false, code: "TRIAL_WORLD_LIMIT_REACHED" });
  });

  it("an unfinished compile still counts: it may yet become the World", async () => {
    jobs = [review(1), running()];
    expect(await check()).toEqual({ ok: true, allowed: false, code: "TRIAL_WORLD_LIMIT_REACHED" });
  });

  it("a review_required row with no candidate digest keeps counting (the old answer)", async () => {
    jobs = [{ state: "review_required", collection_id: collection(1), candidate_manifest_digest: null }];
    expect(await check()).toEqual({ ok: true, allowed: false, code: "TRIAL_WORLD_LIMIT_REACHED" });
  });

  it("an idempotent retry of the same set is still allowed", async () => {
    jobs = [review(1), review(2)];
    // The first store read is the replay probe for this exact document set.
    admin.mockImplementationOnce(async () => Response.json([{ job_id: "cjob-1" }]));
    expect(await check()).toEqual({ ok: true, allowed: true });
    expect(candidate).not.toHaveBeenCalled();
  });

  it("does not read jobs at all for an account with no live evaluation (paid accounts unaffected)", async () => {
    trial.mockResolvedValueOnce({ ok: true, trial: null });
    expect(await check()).toEqual({ ok: true, allowed: true });
    trial.mockResolvedValueOnce({ ok: true, trial: { status: "converted", expiresAt: "2999-01-01T00:00:00Z" } });
    expect(await check()).toEqual({ ok: true, allowed: true });
    expect(admin).not.toHaveBeenCalled();
  });
});

describe("trial compile capacity fails closed: cannot read means refuse", () => {
  it.each([
    ["the job list fails", () => { jobs = "fail"; }],
    ["the job list is not JSON", () => { jobs = "garbage"; }],
    ["the active Worlds cannot be read", () => { jobs = [review(1)]; activeWorlds.mockResolvedValueOnce({ ok: false, code: "WORLD_STORE_READ_FAILED" }); }],
    ["the active Worlds are a partial page", () => { jobs = [review(1)]; activeWorlds.mockResolvedValueOnce({ ok: true, worlds: [], nextCursor: collection(9) }); }],
    ["no storage signer", () => { jobs = [review(1)]; signer.mockReturnValueOnce(null); }],
    ["the candidate cannot be read", () => { jobs = [review(1)]; candidate.mockResolvedValueOnce({ ok: false, code: "GET_TIMEOUT" }); }],
    ["the candidate read is forbidden", () => { jobs = [review(1)]; candidate.mockResolvedValueOnce({ ok: false, code: "GET_FORBIDDEN" }); }],
  ])("%s", async (_name, arrange) => {
    arrange();
    expect(await check()).toEqual({ ok: false, code: "TRIAL_COMPILE_CHECK_FAILED" });
  });

  /*
    Review T-1 (train 3c): deleting a source deletes its review_required candidate (migration 20260930010000)
    while the job row stays. A definite NOT_FOUND is a spent attempt, not a 503 for ever; the cap still holds.
  */
  it("a candidate deleted with its source counts as a spent attempt, not a 503", async () => {
    jobs = [review(1)];
    candidate.mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" });
    expect(await check()).toEqual({ ok: true, allowed: true });
    expect(promotable).not.toHaveBeenCalled();
  });

  it("deleted candidates still spend the two attempts: the third compile is refused 402", async () => {
    jobs = [review(1), review(2)];
    candidate.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    expect(await check()).toEqual({ ok: true, allowed: false, code: "TRIAL_COMPILE_ATTEMPTS_EXHAUSTED" });
  });

  it("one deleted and one review candidate also exhaust the attempts", async () => {
    jobs = [review(1), review(2)];
    candidate.mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" });
    expect(await check()).toEqual({ ok: true, allowed: false, code: "TRIAL_COMPILE_ATTEMPTS_EXHAUSTED" });
  });

  it("an allow read from a full page is not trusted", async () => {
    worldLimit = 10;
    jobs = Array.from({ length: 20 }, (_, n) => review(n + 1));
    verdict = new Map(jobs.map((row) => [row.collection_id!, false]));
    // Two dead ends refuse before the page matters.
    expect(await check()).toEqual({ ok: true, allowed: false, code: "TRIAL_COMPILE_ATTEMPTS_EXHAUSTED" });
    // A full page of rows that refuse nothing on their own still does not allow.
    jobs = Array.from({ length: 20 }, () => ({ state: "review_required", collection_id: null, candidate_manifest_digest: null }));
    worldLimit = 21;
    expect(await check()).toEqual({ ok: false, code: "TRIAL_COMPILE_CHECK_FAILED" });
  });

  it("reads at most worldLimit + attempt-limit candidates", async () => {
    jobs = Array.from({ length: 6 }, (_, n) => review(n + 1));
    await check();
    expect(candidate.mock.calls.length).toBeLessThanOrEqual(1 + TRIAL_NON_PROMOTABLE_COMPILE_LIMIT);
  });
});
