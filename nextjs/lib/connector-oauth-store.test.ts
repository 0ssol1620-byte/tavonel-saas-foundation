import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markOAuthConnectionReauthorizationRequired } from "./connector-oauth-store";

// The withdrawn-grant flag is the only writer of `reauthorization_required`, and it is written
// by a worker with no user watching. So the assertions here are about the two things that
// cannot be observed later: the row it is allowed to touch, and its refusal to report success
// when it touched nothing.

const INPUT = {
  workspaceKey: "pilot-acme01",
  userId: "11111111-1111-4111-8111-111111111111",
  oauthConnectionId: "22222222-2222-4222-8222-222222222222",
  errorCode: "OAUTH_TOKEN_REFRESH_FAILED",
};

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://oauth-test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"x".repeat(40)}`);
}

function respond(body: unknown, status = 200) {
  const fetcher = vi.fn(async () => Response.json(body, { status }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(() => {
  // Vercel Production carries real Supabase configuration; tests start empty and opt in.
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("markOAuthConnectionReauthorizationRequired", () => {
  it("refuses without reaching the network when the store is not configured", async () => {
    const fetcher = respond([{ oauth_connection_id: INPUT.oauthConnectionId }]);
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({
      ok: false,
      code: "OAUTH_STORE_NOT_CONFIGURED",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("patches exactly one workspace-scoped, unrevoked row with the terminal error code", async () => {
    configure();
    const fetcher = respond([{ oauth_connection_id: INPUT.oauthConnectionId }]);
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({ ok: true });

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`oauth_connection_id=eq.${INPUT.oauthConnectionId}`);
    // Tenant scope and the revoked guard are in the query, not in application code: a
    // revoked connection is a closed record and must never be reopened by a worker.
    expect(url).toContain(`workspace_key=eq.${INPUT.workspaceKey}`);
    expect(url).toContain("status=neq.revoked");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: "reauthorization_required",
      last_error_code: "OAUTH_TOKEN_REFRESH_FAILED",
      updated_by: INPUT.userId,
    });
    expect(typeof body.updated_at).toBe("string");
  });

  it("refuses when the filter matched nothing, as it does for a revoked connection", async () => {
    configure();
    respond([]);
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({
      ok: false,
      code: "OAUTH_CONNECTION_NOT_FOUND",
    });
  });

  it("refuses a rejected write rather than assuming the flag landed", async () => {
    configure();
    respond({ code: "42501" }, 403);
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({
      ok: false,
      code: "OAUTH_CONNECTION_STATUS_WRITE_FAILED",
    });
  });

  it("refuses a write that touched more than the one named connection", async () => {
    configure();
    respond([{ oauth_connection_id: "a" }, { oauth_connection_id: "b" }]);
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({
      ok: false,
      code: "OAUTH_CONNECTION_STATUS_WRITE_FAILED",
    });
  });

  it("refuses a transport failure instead of throwing into the worker", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({
      ok: false,
      code: "OAUTH_CONNECTION_STATUS_WRITE_FAILED",
    });
  });
});
