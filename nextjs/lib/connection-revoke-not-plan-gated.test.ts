import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  "Never let an ACL revoke wait" (constitution, runtime invariants).

  The three revocation routes -- a storage connection, an OAuth provider connection and its broker
  credential, and the Google viewer links -- used to ask for the Team plan. A workspace whose plan
  lapsed, was put on billing hold, or was a free evaluation could not withdraw what it had shared.
  They now ask who the caller is and which workspace they belong to, and nothing about the plan.
  The tenant boundary is unchanged: every store call carries the caller's own workspace.
*/

const WORKSPACE = "pilot-1234567890abcdef";
const OTHER_WORKSPACE = "pilot-fedcba0987654321";
const USER = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const CONNECTION = "22222222-2222-4222-8222-222222222222";

const m = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  foundationPilotAccess: vi.fn(),
  getWorkspaceMembership: vi.fn(),
  authorizeFoundationSessionProduct: vi.fn(),
  trialFeatureBlocked: vi.fn(),
  authorizeFoundationProduct: vi.fn(),
  authenticateDeveloperApiKey: vi.fn(),
  consumeDeveloperApiRateLimit: vi.fn(),
  revokeFoundationConnection: vi.fn(),
  getOAuthConnectionSecretReference: vi.fn(),
  revokeOAuthConnection: vi.fn(),
  revokeGoogleDriveViewerPrincipals: vi.fn(),
  deleteOAuthSecret: vi.fn(),
  readOAuthSecretBrokerConfig: vi.fn(),
}));

vi.mock("./foundation-pilot", () => ({ getRequestUser: m.getRequestUser, foundationPilotAccess: m.foundationPilotAccess }));
vi.mock("./workspace-membership", () => ({ getWorkspaceMembership: m.getWorkspaceMembership }));
vi.mock("./self-service-trial", () => ({
  authorizeFoundationSessionProduct: m.authorizeFoundationSessionProduct,
  trialFeatureBlocked: m.trialFeatureBlocked,
}));
vi.mock("./billing-product-access", () => ({ authorizeFoundationProduct: m.authorizeFoundationProduct }));
vi.mock("./developer-store", () => ({
  authenticateDeveloperApiKey: m.authenticateDeveloperApiKey,
  consumeDeveloperApiRateLimit: m.consumeDeveloperApiRateLimit,
  revokeFoundationConnection: m.revokeFoundationConnection,
}));
vi.mock("@/lib/connector-oauth-store", () => ({
  getOAuthConnectionSecretReference: m.getOAuthConnectionSecretReference,
  revokeOAuthConnection: m.revokeOAuthConnection,
  revokeGoogleDriveViewerPrincipals: m.revokeGoogleDriveViewerPrincipals,
}));
vi.mock("@/lib/connector-oauth-secrets", () => ({
  deleteOAuthSecret: m.deleteOAuthSecret,
  readOAuthSecretBrokerConfig: m.readOAuthSecretBrokerConfig,
}));
vi.mock("@/lib/connector-oauth", () => ({ googleDriveViewerLinkEnabled: () => true }));

import { DELETE as revokeStorageConnection } from "../app/api/connections/[id]/route";
import { DELETE as revokeOAuthConnectionRoute } from "../app/api/v1/oauth-connectors/connections/[id]/route";
import { POST as revokeViewerLinks } from "../app/api/v1/oauth-connectors/viewer-links/revoke/route";

const session = (url: string, method: string) =>
  new Request(url, { method, headers: { authorization: "Bearer supabase-session" } });
const params = { params: Promise.resolve({ id: CONNECTION }) };

const callAll = async () => ({
  storage: await revokeStorageConnection(session(`https://tavonel.com/api/connections/${CONNECTION}`, "DELETE"), params),
  oauth: await revokeOAuthConnectionRoute(session(`https://tavonel.com/api/v1/oauth-connectors/connections/${CONNECTION}`, "DELETE"), params),
  viewer: await revokeViewerLinks(session("https://tavonel.com/api/v1/oauth-connectors/viewer-links/revoke", "POST")),
});

/** The refusals the plan gate used to answer a revoke with. None of them may reach a revoke now. */
const PLAN_STATES = {
  lapsed: { ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 },
  "billing hold": { ok: false, code: "BILLING_HOLD", status: 402 },
  "Developer under the old Team gate": { ok: false, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 },
  "free evaluation": { ok: true, access: { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: "2026-11-17T00:00:00Z" } },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  m.getRequestUser.mockResolvedValue({ id: USER, email: "owner@example.invalid" });
  m.foundationPilotAccess.mockReturnValue({ membership: { workspaceId: WORKSPACE } });
  m.getWorkspaceMembership.mockResolvedValue({ ok: true, membership: { state: "active", role: "owner", authorizationRevision: 3 } });
  m.trialFeatureBlocked.mockReturnValue(true);
  m.authorizeFoundationProduct.mockResolvedValue({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
  m.consumeDeveloperApiRateLimit.mockResolvedValue({ ok: true });
  m.revokeFoundationConnection.mockResolvedValue({ ok: true });
  m.readOAuthSecretBrokerConfig.mockReturnValue({ url: "https://broker.invalid", token: "fixture" });
  m.getOAuthConnectionSecretReference.mockResolvedValue({ ok: true, refreshTokenReference: "vault://oauth/fixture-refresh" });
  m.deleteOAuthSecret.mockResolvedValue(undefined);
  m.revokeOAuthConnection.mockResolvedValue({ ok: true });
  m.revokeGoogleDriveViewerPrincipals.mockResolvedValue({ ok: true, revokedCount: 2 });
});

describe("revocation is not plan-gated", () => {
  it.each(Object.entries(PLAN_STATES))("a %s workspace revokes all three, inside its own workspace", async (_state, decision) => {
    m.authorizeFoundationSessionProduct.mockResolvedValue(decision);
    const { storage, oauth, viewer } = await callAll();
    expect([storage.status, oauth.status, viewer.status]).toEqual([204, 204, 200]);
    expect(m.authorizeFoundationSessionProduct).not.toHaveBeenCalled();
    expect(m.trialFeatureBlocked).not.toHaveBeenCalled();
    expect(m.revokeFoundationConnection).toHaveBeenCalledWith(WORKSPACE, CONNECTION, { userId: USER, keyId: undefined });
    expect(m.getOAuthConnectionSecretReference).toHaveBeenCalledWith(WORKSPACE, CONNECTION);
    // The broker credential goes before the row, exactly as with a paid plan.
    expect(m.deleteOAuthSecret).toHaveBeenCalledWith(expect.anything(), "vault://oauth/fixture-refresh");
    expect(m.deleteOAuthSecret.mock.invocationCallOrder[0]).toBeLessThan(m.revokeOAuthConnection.mock.invocationCallOrder[0]!);
    expect(m.revokeOAuthConnection).toHaveBeenCalledWith(WORKSPACE, USER, CONNECTION);
    expect(m.revokeGoogleDriveViewerPrincipals).toHaveBeenCalledWith({ workspaceKey: WORKSPACE, userId: USER, authorizationRevision: 3 });
  });

  it("a lapsed workspace's API key with the write scope revokes its storage connection", async () => {
    m.authenticateDeveloperApiKey.mockResolvedValue({ ok: true, principal: {
      kind: "api-key", keyId: "key-1", workspaceKey: WORKSPACE, userId: USER, scopes: ["connections:write"], authorizationRevision: 3,
    } });
    const response = await revokeStorageConnection(new Request(`https://tavonel.com/api/connections/${CONNECTION}`, {
      method: "DELETE", headers: { authorization: `Bearer tvnl_live_${"a".repeat(32)}` },
    }), params);
    expect(response.status).toBe(204);
    expect(m.authorizeFoundationProduct).not.toHaveBeenCalled();
    expect(m.revokeFoundationConnection).toHaveBeenCalledWith(WORKSPACE, CONNECTION, { userId: USER, keyId: "key-1" });
  });
});

describe("the tenant boundary still holds", () => {
  it("refuses a caller who is not an active member of the workspace, and touches nothing", async () => {
    m.getWorkspaceMembership.mockResolvedValue({ ok: true, membership: null });
    const { storage, oauth, viewer } = await callAll();
    for (const response of [storage, oauth, viewer]) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ code: "WORKSPACE_MEMBERSHIP_REQUIRED" });
    }
    for (const store of [m.revokeFoundationConnection, m.getOAuthConnectionSecretReference, m.deleteOAuthSecret, m.revokeOAuthConnection, m.revokeGoogleDriveViewerPrincipals]) {
      expect(store).not.toHaveBeenCalled();
    }
  });

  it("refuses an API key issued for another workspace", async () => {
    m.authenticateDeveloperApiKey.mockResolvedValue({ ok: true, principal: {
      kind: "api-key", keyId: "key-2", workspaceKey: OTHER_WORKSPACE, userId: USER, scopes: ["connections:write"], authorizationRevision: 3,
    } });
    const response = await revokeStorageConnection(new Request(`https://tavonel.com/api/connections/${CONNECTION}`, {
      method: "DELETE", headers: { authorization: `Bearer tvnl_live_${"b".repeat(32)}` },
    }), params);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "PILOT_ACCESS_REQUIRED" });
    expect(m.revokeFoundationConnection).not.toHaveBeenCalled();
  });

  it("refuses an API key without the write scope", async () => {
    m.authenticateDeveloperApiKey.mockResolvedValue({ ok: true, principal: {
      kind: "api-key", keyId: "key-3", workspaceKey: WORKSPACE, userId: USER, scopes: ["connections:read"], authorizationRevision: 3,
    } });
    const response = await revokeStorageConnection(new Request(`https://tavonel.com/api/connections/${CONNECTION}`, {
      method: "DELETE", headers: { authorization: `Bearer tvnl_live_${"c".repeat(32)}` },
    }), params);
    expect(response.status).toBe(403);
    expect(m.revokeFoundationConnection).not.toHaveBeenCalled();
  });

  it("a connection of another workspace is not found from this one, and its credential is not touched", async () => {
    m.getOAuthConnectionSecretReference.mockResolvedValue({ ok: false, code: "OAUTH_CONNECTION_NOT_FOUND" });
    const response = await revokeOAuthConnectionRoute(session(`https://tavonel.com/api/v1/oauth-connectors/connections/${CONNECTION}`, "DELETE"), params);
    expect(response.status).toBe(404);
    expect(m.getOAuthConnectionSecretReference).toHaveBeenCalledWith(WORKSPACE, CONNECTION);
    expect(m.deleteOAuthSecret).not.toHaveBeenCalled();
    expect(m.revokeOAuthConnection).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    m.getRequestUser.mockResolvedValue(null);
    const { storage, oauth, viewer } = await callAll();
    expect([storage.status, oauth.status, viewer.status]).toEqual([401, 401, 401]);
  });

  it("keeps the row when the broker credential cannot be deleted", async () => {
    m.deleteOAuthSecret.mockRejectedValue(new Error("broker down"));
    const response = await revokeOAuthConnectionRoute(session(`https://tavonel.com/api/v1/oauth-connectors/connections/${CONNECTION}`, "DELETE"), params);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "OAUTH_SECRET_REVOCATION_FAILED" });
    expect(m.revokeOAuthConnection).not.toHaveBeenCalled();
  });
});
