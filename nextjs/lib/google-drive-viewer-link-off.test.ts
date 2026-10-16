import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  SEC-3 (review 2). TAVONEL_GOOGLE_VIEWER_LINK_ENABLED is absent in production, and the viewer-link
  RPCs exist only in supabase/drafts/google-viewer-principal-boundary.sql. With the flag off the
  revoke route says the feature is off -- never a store failure -- and the page does not exist.
*/

vi.mock("@/lib/developer-auth", () => ({
  requireFoundationSession: vi.fn(async () => ({
    ok: true,
    principal: { kind: "session", workspaceKey: "pilot-1234567890abcdef", userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1", scopes: [], authorizationRevision: 4 },
  })),
}));

import { POST as revokeViewerLinks } from "../app/api/v1/oauth-connectors/viewer-links/revoke/route";
import GoogleDriveAccessLayout from "../app/workspace/google-drive-access/layout";

function revokeRequest() {
  return new Request("https://tavonel.com/api/v1/oauth-connectors/viewer-links/revoke", { method: "POST", headers: { authorization: "Bearer session" } });
}

beforeEach(() => {
  for (const key of ["TAVONEL_GOOGLE_VIEWER_LINK_ENABLED", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) vi.stubEnv(key, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Google viewer link with the flag off (production)", () => {
  it("answers revoke with GOOGLE_VIEWER_LINK_NOT_ENABLED and calls no store", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://oauth-test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"x".repeat(40)}`);
    const fetcher = vi.fn(async () => Response.json({ code: "PGRST202" }, { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await revokeViewerLinks(revokeRequest());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "GOOGLE_VIEWER_LINK_NOT_ENABLED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reaches the revoke RPC only with the flag on", async () => {
    vi.stubEnv("TAVONEL_GOOGLE_VIEWER_LINK_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://oauth-test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"x".repeat(40)}`);
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json(2));
    vi.stubGlobal("fetch", fetcher);
    const response = await revokeViewerLinks(revokeRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ code: "GOOGLE_VIEWER_LINKS_REVOKED", revokedCount: 2 });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/rest/v1/rpc/revoke_google_drive_viewer_principals");
  });

  it("renders no Google Drive access page while the flag is off", () => {
    let thrown: unknown = null;
    try { GoogleDriveAccessLayout({ children: null }); } catch (error) { thrown = error; }
    expect(String((thrown as { digest?: unknown } | null)?.digest)).toMatch(/404/);
    vi.stubEnv("TAVONEL_GOOGLE_VIEWER_LINK_ENABLED", "true");
    expect(GoogleDriveAccessLayout({ children: "page" })).toBe("page");
  });
});
