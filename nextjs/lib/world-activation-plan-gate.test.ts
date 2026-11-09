import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_BILLING_ACCOUNT, type FoundationBillingAccount } from "./billing-store";

/*
  Who may activate a World, exercised through the two routes that activate one.

  `billing-product-access.test.ts` already proves the decision. What this file proves is that
  promote and rollback ask it the activation question *with the caller's real workspace role* --
  the wiring that a mocked `authorizeFoundationProduct` (which every other route test uses, for
  good reason) cannot see. So the mocks here stop one layer lower, at the grant and billing rows,
  and the real `authorizeFoundationProduct` runs.

  The two routes are asserted separately rather than through a shared helper, because "rollback
  mirrors promote" is the claim under test and a helper that drove both would assume it.
*/
const { getUser, pilotAccess, grant, billing, candidate, rollback, apiRequest, activeWorld, ceiling, trialRow, activeWorlds, trialUsage } = vi.hoisted(() => ({
  trialRow: vi.fn(),
  activeWorlds: vi.fn(),
  trialUsage: vi.fn(),
  ceiling: vi.fn(),
  getUser: vi.fn(),
  pilotAccess: vi.fn(),
  grant: vi.fn(),
  billing: vi.fn(),
  candidate: vi.fn(),
  rollback: vi.fn(),
  apiRequest: vi.fn(),
  activeWorld: vi.fn(),
}));

vi.mock("@/lib/foundation-pilot", () => ({ getRequestUser: getUser, foundationPilotAccess: pilotAccess }));
/*
  The retrieval-index route reaches the plan question through the developer-API entry point, so
  authentication, scope and rate limiting are answered by this mock and the plan/role check in the
  route is the real one. That is the point of including it here: rebuilding the index is the
  recovery path for a promotion that half-succeeded, so a plan that may promote and may not
  rebuild would leave its own Worlds answering from the fallback with no way back.
*/
vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest: apiRequest }));
/*
  The self-serve ceiling FD-02 made necessary, mocked here for the same reason the grant rows are
  real: what this file is about is the plan question, and a limiter that reads the audit tables
  would answer it with a transport error. `lib/activation-rate-limit.test.ts` holds the counting;
  the three cases at the bottom of this file hold that each route actually consults it, which is
  the wiring a mocked limiter is otherwise free to lose.
*/
vi.mock("@/lib/activation-rate-limit", () => ({ checkActivationRateLimit: ceiling }));
vi.mock("@/lib/world-rollback-source-access", () => ({ checkRollbackSourceAccess: async () => ({ ok: true }) }));
vi.mock("@/lib/account-grants", () => ({ getFoundationAccountGrant: grant, getFoundationSelfServiceTrial: trialRow }));
/*
  The trial's bounds live in `foundation_trial_ai_access` (migration 20261104090000). Only that RPC
  is answered here; any other store path reaching this mock is a test failure, not a quiet 200.
*/
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://store.test", serviceRoleKey: "k".repeat(40) }),
  supabaseAdminRequest: async (_config: unknown, path: string, init?: RequestInit) => {
    if (path !== "/rest/v1/rpc/foundation_trial_ai_access") throw new Error(`unexpected store path ${path}`);
    return trialUsage(JSON.parse(String(init?.body ?? "{}")));
  },
}));
vi.mock("@/lib/billing-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./billing-store")>()),
  getFoundationBillingAccount: billing,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "tavonel-foundation", accessKeyId: "key", secretAccessKey: "secret" }),
}));
vi.mock("@/lib/r2-objects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-objects")>()),
  getWorkspaceCollectionCandidate: candidate,
}));
vi.mock("@/lib/world-store", () => ({
  promoteFoundationCandidate: vi.fn(),
  rollbackFoundationWorld: rollback,
  getFoundationActiveWorld: activeWorld,
  listFoundationActiveWorlds: activeWorlds,
}));

import { POST as promoteRoute } from "../app/api/collections/[id]/promote/route";
import { POST as rollbackRoute } from "../app/api/collections/[id]/world/rollback/route";
import { POST as retrievalIndexRoute } from "../app/api/v1/collections/[id]/retrieval-index/route";

const userId = "969dc192-daa2-4119-a5d9-9a7621f171a1";
const workspaceId = "pilot-activation";
const collectionId = `collection-${"c".repeat(32)}`;
const digest = `sha256:${"a".repeat(64)}`;
const target = `sha256:${"b".repeat(64)}`;

type Plan = "observer_access" | "studio_access";
type Role = "owner" | "admin" | "member" | "viewer";

function signedIn(plan: Plan | null, role: Role) {
  getUser.mockResolvedValue({ id: userId });
  pilotAccess.mockReturnValue({ membership: { workspaceId, userId, role }, entitlement: {} });
  grant.mockResolvedValue({ ok: true, grant: null });
  billing.mockResolvedValue({
    ok: true,
    account: {
      workspaceKey: workspaceId,
      userId,
      ...EMPTY_BILLING_ACCOUNT,
      // No plan at all is the evaluation trial: it never bought a subscription.
      ...(plan ? { accessPlan: plan, subscriptionStatus: "active" } : {}),
    } satisfies FoundationBillingAccount,
  });
  // A caller that already authenticated and holds collections:compile. The plan is not decided
  // here -- that is what the route asks `authorizeFoundationProduct` next.
  apiRequest.mockResolvedValue({
    ok: true,
    principal: { kind: "session", workspaceKey: workspaceId, userId, scopes: ["collections:compile"] },
  });
}

/** A free evaluation: no plan bought, a live trial row, the bounds RPC answering `usage`. */
function onTrial(role: Role, usage: Record<string, unknown> | null = { status: "allowed" }) {
  signedIn(null, role);
  trialRow.mockResolvedValue({ ok: true, trial: { status: "trialing", expiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
  trialUsage.mockResolvedValue(usage ? new Response(JSON.stringify(usage)) : new Response("", { status: 500 }));
}

function promoteRequest() {
  const body = JSON.stringify({
    operationId: "11111111-1111-4111-8111-111111111111",
    manifestDigest: digest,
    expectedCurrentManifest: null,
    expectedCurrentRevision: 0,
    reason: "activation gate test",
  });
  return promoteRoute(
    new Request("https://tavonel.com/api/collections/x/promote", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(body.length) },
      body,
    }),
    { params: Promise.resolve({ id: collectionId }) },
  );
}

function rollbackRequest() {
  const body = JSON.stringify({
    operationId: "22222222-2222-4222-8222-222222222222",
    targetManifestDigest: target,
    expectedCurrentManifest: digest,
    expectedCurrentRevision: 1,
    reason: "activation gate test",
  });
  return rollbackRoute(
    new Request("https://tavonel.com/api/collections/x/world/rollback", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(body.length) },
      body,
    }),
    { params: Promise.resolve({ id: collectionId }) },
  );
}

function retrievalIndexRequest() {
  return retrievalIndexRoute(
    new Request("https://tavonel.com/api/v1/collections/x/retrieval-index", { method: "POST" }),
    { params: Promise.resolve({ id: collectionId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ceiling.mockResolvedValue({ ok: true });
  // Past the plan gate, promote's next step is loading the candidate, rollback's is the mutation
  // and the index rebuild's is reading the active World. All three are answered here so a test
  // can tell "refused by the plan" from "admitted".
  candidate.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
  rollback.mockResolvedValue({ ok: true, result: { collectionId, manifestDigest: target } });
  activeWorld.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
  activeWorlds.mockResolvedValue({ ok: true, worlds: [], nextCursor: null });
  trialRow.mockResolvedValue({ ok: true, trial: null });
});

describe("promote", () => {
  it("admits the Developer plan when the caller owns the workspace", async () => {
    signedIn("observer_access", "owner");
    const response = await promoteRequest();
    // 404 is the candidate lookup, two gates past the plan check: the plan admitted it.
    expect(response.status).toBe(404);
    expect(candidate).toHaveBeenCalled();
  });

  it.each(["admin", "member", "viewer"] as const)("refuses a Developer-plan %s", async (role) => {
    signedIn("observer_access", role);
    const response = await promoteRequest();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "STUDIO_SUBSCRIPTION_REQUIRED" });
    expect(candidate).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"] as const)("leaves the Team plan admitted for a %s", async (role) => {
    signedIn("studio_access", role);
    const response = await promoteRequest();
    expect(response.status).toBe(404);
  });

  it("asks a paid plan nothing about a trial", async () => {
    signedIn("observer_access", "owner");
    await promoteRequest();
    expect(trialRow).not.toHaveBeenCalled();
    expect(trialUsage).not.toHaveBeenCalled();
    expect(activeWorlds).not.toHaveBeenCalled();
  });

  it("still refuses a workspace with neither a plan nor a live trial", async () => {
    signedIn(null, "owner");
    const response = await promoteRequest();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "SUBSCRIPTION_REQUIRED" });
    expect(candidate).not.toHaveBeenCalled();
  });
});

/*
  P0 2026-11-09: the free evaluation's one World. /pricing sells "1 Compiled World with Evidence and
  Ask", so a trial owner reaches activation once, inside the bounds the database owns, and every
  other promote gate still runs after this one.
*/
describe("promote on a free evaluation", () => {
  it("admits the trial owner's first World, and peeks at the bounds without spending a query", async () => {
    onTrial("owner");
    const response = await promoteRequest();
    // 404 is the candidate lookup: past the plan gate, every later gate still runs.
    expect(response.status).toBe(404);
    expect(candidate).toHaveBeenCalled();
    expect(trialUsage).toHaveBeenCalledWith(expect.objectContaining({ p_consume_query: false, p_workspace_key: workspaceId }));
  });

  it("refuses a second World", async () => {
    onTrial("owner");
    activeWorlds.mockResolvedValue({ ok: true, nextCursor: null, worlds: [
      { collectionId: `collection-${"d".repeat(32)}`, manifestDigest: target, revision: 1, updatedAt: "2026-11-09T00:00:00Z" },
    ] });
    const response = await promoteRequest();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "TRIAL_WORLD_LIMIT_REACHED" });
    expect(candidate).not.toHaveBeenCalled();
  });

  it("refuses a new revision of the World it already activated", async () => {
    onTrial("owner");
    activeWorlds.mockResolvedValue({ ok: true, nextCursor: null, worlds: [
      { collectionId, manifestDigest: target, revision: 1, updatedAt: "2026-11-09T00:00:00Z" },
    ] });
    const response = await promoteRequest();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "TRIAL_WORLD_LIMIT_REACHED" });
  });

  it("refuses once the database says a trial bound is spent", async () => {
    onTrial("owner", { status: "limit_reached", reason: "TRIAL_AI_WINDOW_ENDED" });
    const response = await promoteRequest();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "TRIAL_LIMIT_REACHED" });
    expect(candidate).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the bounds cannot be read", async () => {
    onTrial("owner", null);
    const response = await promoteRequest();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "TRIAL_AI_ACCESS_CHECK_FAILED" });
    expect(candidate).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the active Worlds cannot be listed", async () => {
    onTrial("owner");
    activeWorlds.mockResolvedValue({ ok: false, code: "WORLD_STORE_READ_FAILED" });
    const response = await promoteRequest();
    expect(response.status).toBe(503);
    expect(candidate).not.toHaveBeenCalled();
  });

  it.each(["admin", "member", "viewer"] as const)("refuses a trial %s", async (role) => {
    onTrial(role);
    const response = await promoteRequest();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "SUBSCRIPTION_REQUIRED" });
    expect(candidate).not.toHaveBeenCalled();
  });

  it("does not stretch to rollback, which stays with a paid plan", async () => {
    onTrial("owner");
    const response = await rollbackRequest();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "SUBSCRIPTION_REQUIRED" });
    expect(rollback).not.toHaveBeenCalled();
  });

  it("still refuses a Team-plan member on the role gate, not the plan gate", async () => {
    signedIn("studio_access", "member");
    const response = await promoteRequest();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "PROMOTION_ROLE_REQUIRED" });
  });
});

describe("rollback mirrors promote", () => {
  it("admits the Developer plan when the caller owns the workspace", async () => {
    signedIn("observer_access", "owner");
    const response = await rollbackRequest();
    expect(response.status).toBe(200);
    expect(rollback).toHaveBeenCalled();
  });

  it.each(["admin", "member", "viewer"] as const)("refuses a Developer-plan %s", async (role) => {
    signedIn("observer_access", role);
    const response = await rollbackRequest();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "STUDIO_SUBSCRIPTION_REQUIRED" });
    expect(rollback).not.toHaveBeenCalled();
  });

  it("refuses an evaluation trial holding the owner role", async () => {
    signedIn(null, "owner");
    const response = await rollbackRequest();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "SUBSCRIPTION_REQUIRED" });
  });

  it.each(["owner", "admin"] as const)("leaves the Team plan admitted for a %s", async (role) => {
    signedIn("studio_access", role);
    const response = await rollbackRequest();
    expect(response.status).toBe(200);
  });

  it("still refuses a Team-plan member on the role gate, not the plan gate", async () => {
    signedIn("studio_access", "member");
    const response = await rollbackRequest();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "ROLLBACK_ROLE_REQUIRED" });
  });
});

/*
  The index rebuild takes the same bar, for the reason R9 finding #2 names.

  It documented itself as scope + owner/admin and silently also demanded the Team plan, so a
  Developer owner who could promote was refused the rebuild of the index their own promote
  triggers. It now asks the activation question, and the docs sentence says so.
*/
describe("retrieval-index rebuild takes the activation bar", () => {
  it("admits the Developer plan when the caller owns the workspace", async () => {
    signedIn("observer_access", "owner");
    const response = await retrievalIndexRequest();
    // 409 is the active-World lookup, past both the plan and the role gate.
    expect(response.status).toBe(409);
    expect(activeWorld).toHaveBeenCalled();
  });

  it.each(["admin", "member", "viewer"] as const)("refuses a Developer-plan %s", async (role) => {
    signedIn("observer_access", role);
    const response = await retrievalIndexRequest();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "STUDIO_SUBSCRIPTION_REQUIRED" });
    expect(activeWorld).not.toHaveBeenCalled();
  });

  it("refuses an evaluation trial holding the owner role", async () => {
    signedIn(null, "owner");
    const response = await retrievalIndexRequest();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "SUBSCRIPTION_REQUIRED" });
    expect(activeWorld).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"] as const)("leaves the Team plan admitted for a %s", async (role) => {
    signedIn("studio_access", role);
    const response = await retrievalIndexRequest();
    expect(response.status).toBe(409);
  });

  it("refuses a Team-plan member on the role gate, not the plan gate", async () => {
    signedIn("studio_access", "member");
    const response = await retrievalIndexRequest();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "RETRIEVAL_COMPILE_ROLE_REQUIRED" });
  });
});

/*
  The hour's ceiling, on all three routes.

  FD-02 replaced a human step with a card: Team was sold through a conversation, so somebody met
  the buyer before they could reach the embedder, and Developer is a self-serve checkout. None of
  these three routes had a call-frequency limit of any kind -- `consumeDeveloperApiRateLimit`
  covers the API-key surface and never runs on a session-authenticated promote.

  Each case asserts the two halves a client depends on: the typed code, and that the refusal
  happened *before* the work. The plan gate is passed in every case, so a 429 here is the ceiling
  and nothing else.
*/
describe("the per-workspace hourly ceiling", () => {
  const REFUSED = {
    ok: false as const,
    code: "ACTIVATION_RATE_LIMITED" as const,
    status: 429 as const,
    retryAfterSeconds: 1_800,
  };

  it.each([
    ["promote", promoteRequest, () => candidate],
    ["rollback", rollbackRequest, () => rollback],
    ["retrieval-index rebuild", retrievalIndexRequest, () => activeWorld],
  ] as const)("refuses %s with 429 and Retry-After, before the work", async (_name, request, work) => {
    signedIn("observer_access", "owner");
    ceiling.mockResolvedValue(REFUSED);
    const response = await request();
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: "ACTIVATION_RATE_LIMITED" });
    expect(response.headers.get("Retry-After")).toBe("1800");
    expect(work(), "the refusal has to cost nothing").not.toHaveBeenCalled();
  });

  it("refuses with 503 rather than running unbounded when the ceiling cannot be read", async () => {
    signedIn("observer_access", "owner");
    ceiling.mockResolvedValue({
      ok: false, code: "ACTIVATION_RATE_LIMIT_UNAVAILABLE", status: 503, retryAfterSeconds: 60,
    });
    const response = await promoteRequest();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "ACTIVATION_RATE_LIMIT_UNAVAILABLE" });
    expect(candidate).not.toHaveBeenCalled();
  });

  it("asks per workspace, and names the action family it is counting", async () => {
    signedIn("observer_access", "owner");
    await promoteRequest();
    expect(ceiling).toHaveBeenCalledWith(workspaceId, "world_activation");
    ceiling.mockClear();
    await retrievalIndexRequest();
    expect(ceiling).toHaveBeenCalledWith(workspaceId, "retrieval_index_rebuild");
  });
});
