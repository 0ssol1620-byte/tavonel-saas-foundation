import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import {
  checkAuthorizationRequest,
  denialRedirect,
  issueAuthorizationCode,
  remoteMcpEnabled,
  remoteMcpSealingKey,
  type AuthorizationParameters,
} from "@/lib/remote-mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const PARAMETERS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

/*
  POST /api/mcp/oauth/authorize -- the server half of the consent page at /oauth/authorize.

  The browser session is a Supabase bearer held by the page, not a cookie, so the authorization
  endpoint cannot be a plain GET: the page reads the query, asks this route to `describe` it,
  and posts `approve` with the session bearer or `deny` without one. Only `approve` issues a
  code, and only for a session that could create an API key by hand -- the same
  requireFoundationSession check, and the same refusal for a free evaluation.
*/
export async function POST(request: Request) {
  if (!remoteMcpEnabled()) return new NextResponse(null, { status: 404 });
  const key = remoteMcpSealingKey();
  if (!key) return NextResponse.json({ code: "REMOTE_MCP_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  const origin = new URL(request.url).origin;
  const text = await request.text();
  if (text.length > 16_384) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  let body: { decision?: unknown; request?: Record<string, unknown> };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: NO_STORE });
  }
  const parameters: AuthorizationParameters = {};
  for (const name of PARAMETERS) {
    const value = body.request?.[name];
    if (typeof value === "string") parameters[name] = value;
  }

  const checked = checkAuthorizationRequest(parameters, key, origin);
  if (!checked.ok) {
    return checked.redirectTo === null
      ? NextResponse.json({ code: "AUTHORIZATION_REQUEST_INVALID", error: checked.error, description: checked.description }, { status: 400, headers: NO_STORE })
      : NextResponse.json({ code: "AUTHORIZATION_REQUEST_REJECTED", error: checked.error, description: checked.description, redirectTo: checked.redirectTo }, { headers: NO_STORE });
  }
  if (body.decision === "describe") return NextResponse.json({ code: "AUTHORIZATION_REQUEST_VALID", ...checked.view }, { headers: NO_STORE });
  if (body.decision === "deny") return NextResponse.json({ code: "AUTHORIZATION_DENIED", redirectTo: denialRedirect(checked.request, origin) }, { headers: NO_STORE });
  if (body.decision !== "approve") return NextResponse.json({ code: "AUTHORIZATION_DECISION_INVALID" }, { status: 400, headers: NO_STORE });

  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  if (auth.principal.accessSource === "trial") return NextResponse.json({ code: "TRIAL_FEATURE_NOT_INCLUDED" }, { status: 402, headers: NO_STORE });
  return NextResponse.json({
    code: "AUTHORIZATION_GRANTED",
    redirectTo: issueAuthorizationCode(checked.request, auth.principal, key, origin),
  }, { headers: NO_STORE });
}
