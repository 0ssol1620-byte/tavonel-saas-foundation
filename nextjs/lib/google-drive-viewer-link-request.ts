import { getSupabaseBrowserClient } from "./supabase-browser";

export type GoogleViewerLinkAction = "authorize" | "revoke";
export type GoogleViewerLinkRequestResult =
  | { ok: true; authorizationUrl?: string }
  | { ok: false; code: string };

const ROUTES: Record<GoogleViewerLinkAction, string> = {
  authorize: "/api/v1/oauth-connectors/authorize",
  revoke: "/api/v1/oauth-connectors/viewer-links/revoke",
};

const FAILURE_CODES: Record<GoogleViewerLinkAction, string> = {
  authorize: "GOOGLE_VIEWER_LINK_FAILED",
  revoke: "GOOGLE_VIEWER_UNLINK_FAILED",
};

function responseCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("code" in value)) return null;
  return typeof value.code === "string" ? value.code : null;
}

/** Obtain a fresh browser session and send only its access token in the authenticated POST. */
export async function postGoogleViewerLinkRequest(
  action: GoogleViewerLinkAction,
  fetcher: typeof fetch = fetch,
): Promise<GoogleViewerLinkRequestResult> {
  let accessToken: string | null;
  try {
    const client = getSupabaseBrowserClient();
    if (!client) return { ok: false, code: "AUTH_REQUIRED" };
    const { data, error } = await client.auth.getSession();
    accessToken = error ? null : data.session?.access_token ?? null;
  } catch {
    return { ok: false, code: "AUTH_REQUIRED" };
  }
  if (!accessToken) return { ok: false, code: "AUTH_REQUIRED" };

  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
  const init: RequestInit = { method: "POST", headers };
  if (action === "authorize") {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify({
      provider: "google_drive",
      displayName: "Google Drive viewer identity",
      purpose: "viewer_acl_link",
    });
  }

  try {
    const response = await fetcher(ROUTES[action], init);
    let body: unknown = null;
    try { body = await response.json(); } catch { /* Revoke may return an empty success body. */ }
    if (!response.ok) {
      return { ok: false, code: responseCode(body) ?? FAILURE_CODES[action] };
    }
    if (action === "authorize") {
      const authorizationUrl = typeof body === "object" && body !== null && "authorizationUrl" in body
        ? body.authorizationUrl
        : null;
      if (typeof authorizationUrl !== "string") return { ok: false, code: FAILURE_CODES.authorize };
      return { ok: true, authorizationUrl };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: FAILURE_CODES[action] };
  }
}
