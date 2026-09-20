import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticateDeveloperApiKey,
  consumeDeveloperApiRateLimit,
  createDeveloperApiKey,
  rotateDeveloperApiKey,
} from "./developer-store";

const workspaceKey = "pilot-1234567890abcdef";
const userId = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const keyId = "49d42924-a3cc-4a09-b92d-9c86b58901a1";

function configure() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://developer-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${"x".repeat(40)}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("developer credential store", () => {
  it("returns plaintext once while persisting only its digest", async () => {
    configure();
    let persisted: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("create_foundation_api_key_authorized")) {
        persisted = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          key_id: keyId,
          name: "Agent",
          key_prefix: persisted.p_key_prefix,
          scopes: ["documents:read"],
          created_at: "2026-08-30T00:00:00Z",
          expires_at: null,
          last_used_at: null,
          revoked_at: null,
        });
      }
      return new Response(null, { status: 201 });
    }));

    const created = await createDeveloperApiKey({
      workspaceKey,
      userId,
      authorizationRevision: 7,
      name: "Agent",
      scopes: ["documents:read"],
      expiresAt: null,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.token).toMatch(/^tvnl_live_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/);
    expect(persisted).not.toBeNull();
    const persistedRecord = persisted as unknown as Record<string, unknown>;
    expect(persistedRecord).not.toHaveProperty("token");
    expect(persistedRecord.p_token_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedRecord.p_authorization_revision).toBe(7);
    expect(JSON.stringify(persistedRecord)).not.toContain(created.token);
  });

  it("fails closed when atomic creation observes a changed authority epoch", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain("create_foundation_api_key_authorized");
      expect(JSON.parse(String(init?.body))).toHaveProperty("p_authorization_revision", 7);
      return Response.json({ message: "api_key_authorization_changed" }, { status: 409 });
    }));

    await expect(createDeveloperApiKey({
      workspaceKey,
      userId,
      authorizationRevision: 7,
      name: "Agent",
      scopes: ["documents:read"],
      expiresAt: null,
    })).resolves.toEqual({ ok: false, code: "AUTHORIZATION_CHANGED_RETRY" });
  });

  it("authenticates by digest and consumes the database rate counter", async () => {
    configure();
    const token = `tvnl_live_abcdefghijkl_${"a".repeat(43)}`;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("consume_foundation_api_rate_limit")) return Response.json(true);
      if (url.includes("foundation_api_keys") && url.includes("token_sha256")) {
        return Response.json([{
          key_id: keyId,
          workspace_key: workspaceKey,
          created_by: userId,
          scopes: ["documents:read"],
          expires_at: null,
          revoked_at: null,
          authorization_revision: 7,
        }]);
      }
      return Response.json([]);
    }));

    const authenticated = await authenticateDeveloperApiKey(token);
    expect(authenticated.ok).toBe(true);
    expect(urls[0]).not.toContain(token);
    await expect(consumeDeveloperApiRateLimit({
      keyId,
      workspaceKey,
      scope: "documents:read",
      limit: 120,
    })).resolves.toEqual({ ok: true });
  });

  it("returns a replacement token only after the atomic rotation RPC succeeds", async () => {
    configure();
    const requestBodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain("rotate_foundation_api_key");
      const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestBodies.push(requestBody);
      return Response.json({
        keyId: "39d42924-a3cc-4a09-b92d-9c86b58901a1",
        name: "Rotated agent",
        keyPrefix: requestBody.p_new_prefix,
        scopes: ["documents:read"],
        createdAt: "2026-08-30T01:00:00Z",
        expiresAt: null,
        replacedKeyId: keyId,
      });
    }));
    const result = await rotateDeveloperApiKey({
      workspaceKey,
      userId,
      authorizationRevision: 7,
      oldKeyId: keyId,
      name: "Rotated agent",
      scopes: ["documents:read"],
      expiresAt: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const requestBody = requestBodies[0];
    expect(result.token).toMatch(/^tvnl_live_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/);
    expect(requestBody).not.toHaveProperty("p_new_token");
    expect(requestBody?.p_new_token_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(requestBody?.p_authorization_revision).toBe(7);
    expect(JSON.stringify(requestBody)).not.toContain(result.token);
  });
});
