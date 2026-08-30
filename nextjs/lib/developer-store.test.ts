import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticateDeveloperApiKey,
  consumeDeveloperApiRateLimit,
  createDeveloperApiKey,
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
      if (String(input).includes("foundation_api_keys")) {
        persisted = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json([{
          key_id: keyId,
          name: "Agent",
          key_prefix: persisted.key_prefix,
          scopes: ["documents:read"],
          created_at: "2026-08-30T00:00:00Z",
          expires_at: null,
          last_used_at: null,
          revoked_at: null,
        }]);
      }
      return new Response(null, { status: 201 });
    }));

    const created = await createDeveloperApiKey({
      workspaceKey,
      userId,
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
    expect(persistedRecord.token_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(persistedRecord)).not.toContain(created.token);
  });

  it("revokes a newly inserted key when its durable audit write fails", async () => {
    configure();
    const requests: Array<{ url: string; method: string; body: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
      if (url.includes("foundation_api_keys") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json([{
          key_id: keyId,
          name: "Agent",
          key_prefix: body.key_prefix,
          scopes: ["documents:read"],
          created_at: "2026-08-30T00:00:00Z",
          expires_at: null,
          last_used_at: null,
          revoked_at: null,
        }]);
      }
      if (url.includes("foundation_developer_audit_events")) return Response.json({}, { status: 503 });
      return Response.json([]);
    }));

    await expect(createDeveloperApiKey({
      workspaceKey,
      userId,
      name: "Agent",
      scopes: ["documents:read"],
      expiresAt: null,
    })).resolves.toEqual({ ok: false, code: "DEVELOPER_AUDIT_WRITE_FAILED" });
    const compensation = requests.find((request) => request.url.includes(`key_id=eq.${keyId}`) && request.method === "PATCH");
    expect(compensation).toBeTruthy();
    expect(JSON.parse(compensation!.body)).toHaveProperty("revoked_at");
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
});
