import { NextResponse } from "next/server";
import { remoteMcpEnabled, resourceMetadata } from "@/lib/remote-mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  RFC 9728 protected resource metadata for the remote MCP endpoint (G11, contract stage).

  Served at the path-suffixed URL the 401 challenge names (/.well-known/oauth-protected-resource/api/mcp)
  and at the bare one clients fall back to. Any other suffix is a resource this server does not have.
*/
export async function GET(request: Request, context: { params: Promise<{ resource?: string[] }> }) {
  if (!remoteMcpEnabled()) return new NextResponse(null, { status: 404 });
  const { resource = [] } = await context.params;
  if (resource.length > 0 && resource.join("/") !== "api/mcp") return new NextResponse(null, { status: 404 });
  return NextResponse.json(resourceMetadata(new URL(request.url).origin), { headers: { "Cache-Control": "no-store" } });
}
