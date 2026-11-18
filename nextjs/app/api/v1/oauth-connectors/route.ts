import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import { OAUTH_CONNECTOR_PROVIDERS } from "@/lib/connector-oauth";
import { configuredOAuthProviders } from "@/lib/connector-oauth-secrets";
import { listOAuthConnections } from "@/lib/connector-oauth-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store", "X-TAVONEL-API-Version": "1" };

export async function GET(request: Request) {
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });
  const result = await listOAuthConnections(auth.principal.workspaceKey);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: HEADERS });
  const configured = configuredOAuthProviders();
  const providers = OAUTH_CONNECTOR_PROVIDERS.map((provider) => ({ provider, configured: configured.includes(provider) }));
  return NextResponse.json({ code: "OK", apiVersion: 1, providers, connections: result.connections }, { headers: HEADERS });
}
