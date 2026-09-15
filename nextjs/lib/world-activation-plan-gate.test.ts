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
const { getUser, pilotAccess, grant, billing, candidate, rollback, apiRequest, activeWorld, ceiling } = vi.hoisted(() => ({
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
vi.mock("@/lib/account-grants", () => ({ getFoundationAccountGrant: grant }));
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

function promoteRequest() {
  const body = JSON.stringify({ manifestDigest: digest, expectedCurrentManifest: null, reason: "activation gate test" });
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
  const body = JSON.stringify({ targetManifestDigest: target, expectedCurrentManifest: digest, reason: "activation gate test" });
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

  it("refuses an evaluation trial holding the owner role", async () => {
    signedIn(null, "owner");
    const response = await promoteRequest();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "SUBSCRIPTION_REQUIRED" });
  });

  it.each(["owner", "admin"] as const)("leaves the Team plan admitted for a %s", async (role) => {
    signedIn("studio_access", role);
    const response = await promoteRequest();
    expect(response.status).toBe(404);
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
