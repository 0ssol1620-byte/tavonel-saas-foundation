import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClient, getSession } = vi.hoisted(() => ({ getClient: vi.fn(), getSession: vi.fn() }));
vi.mock("./supabase-browser", () => ({ getSupabaseBrowserClient: getClient }));

import { postGoogleViewerLinkRequest } from "./google-drive-viewer-link-request";

const accessToken = "synthetic-session-access-token";
const pageSource = readFileSync(new URL("../app/workspace/google-drive-access/page.tsx", import.meta.url), "utf8");

beforeEach(() => {
  getClient.mockReset().mockReturnValue({ auth: { getSession } });
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: accessToken } }, error: null });
});

describe("Google viewer-link browser requests", () => {
  it("wires both UI actions through the session-bound request helper", () => {
    expect(pageSource).toContain('postGoogleViewerLinkRequest("authorize")');
    expect(pageSource).toContain('postGoogleViewerLinkRequest("revoke")');
    expect(pageSource).toContain("setMessage(result.code)");
    expect(pageSource).not.toContain("Google Drive identity linked.");
  });

  it("sends the current session as Bearer auth on both POST routes", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ authorizationUrl: "https://accounts.google.test/authorize?state=synthetic" }));
    fetcher.mockResolvedValueOnce(Response.json({ authorizationUrl: "https://accounts.google.test/authorize?state=synthetic" }));
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const authorize = await postGoogleViewerLinkRequest("authorize", fetcher as typeof fetch);
    const revoke = await postGoogleViewerLinkRequest("revoke", fetcher as typeof fetch);

    expect(authorize).toEqual({ ok: true, authorizationUrl: "https://accounts.google.test/authorize?state=synthetic" });
    expect(revoke).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/oauth-connectors/authorize");
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/v1/oauth-connectors/viewer-links/revoke");
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${accessToken}`);
    }
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      provider: "google_drive", displayName: "Google Drive viewer identity", purpose: "viewer_acl_link",
    });
    expect(fetcher.mock.calls[1]?.[1]?.body).toBeUndefined();
    expect(JSON.stringify([authorize, revoke])).not.toContain(accessToken);
  });

  it.each(["authorize", "revoke"] as const)("refuses %s when there is no current session", async (action) => {
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const fetcher = vi.fn();

    await expect(postGoogleViewerLinkRequest(action, fetcher as typeof fetch)).resolves.toEqual({
      ok: false, code: "AUTH_REQUIRED",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces the disabled-feature response without navigating or exposing the session token", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ code: "GOOGLE_VIEWER_LINK_NOT_ENABLED" }, { status: 503 }));

    const result = await postGoogleViewerLinkRequest("authorize", fetcher as typeof fetch);

    expect(result).toEqual({ ok: false, code: "GOOGLE_VIEWER_LINK_NOT_ENABLED" });
    expect(JSON.stringify(result)).not.toContain(accessToken);
  });

  it("converts transport failures to a bounded UI code", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      throw new Error(`transport detail ${accessToken}`);
    });

    const result = await postGoogleViewerLinkRequest("revoke", fetcher as typeof fetch);

    expect(result).toEqual({ ok: false, code: "GOOGLE_VIEWER_UNLINK_FAILED" });
    expect(JSON.stringify(result)).not.toContain(accessToken);
  });
});
