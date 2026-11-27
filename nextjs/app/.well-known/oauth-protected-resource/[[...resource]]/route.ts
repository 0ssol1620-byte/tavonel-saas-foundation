import { NextResponse } from "next/server";
import { remoteMcpEnabled, requestOrigin, resourceMetadata } from "@/lib/remote-mcp";
import { agentOAuthEnabled, agentResourceMetadata } from "@/lib/agent-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  RFC 9728 protected resource metadata for the remote MCP endpoint (G11, contract stage).

  Served at the path-suffixed URL the 401 challenge names (/.well-known/oauth-protected-resource/api/mcp)
  and at the bare one clients fall back to. Any other suffix is a resource this server does not have.

  WO-AGENT-OAUTH-1: the agent MCP endpoint is the issuer's second resource, served at its path-suffixed URL only, and only
  while the agent proposals flag is on with a readable cohort (lib/agent-oauth.ts). The bare URL stays /api/mcp's.
*/
export async function GET(request: Request, context: { params: Promise<{ resource?: string[] }> }) {
  if (!remoteMcpEnabled()) return new NextResponse(null, { status: 404 });
  const { resource = [] } = await context.params;
  if (resource.join("/") === "api/agent-mcp" && agentOAuthEnabled()) {
    return NextResponse.json(agentResourceMetadata(requestOrigin(request)), { headers: { "Cache-Control": "no-store" } });
  }
  if (resource.length > 0 && resource.join("/") !== "api/mcp") return new NextResponse(null, { status: 404 });
  return NextResponse.json(resourceMetadata(requestOrigin(request)), { headers: { "Cache-Control": "no-store" } });
}
