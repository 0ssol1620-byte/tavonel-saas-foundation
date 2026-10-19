import { NextResponse } from "next/server";
import { authorizationServerMetadata, remoteMcpEnabled } from "@/lib/remote-mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* RFC 8414 authorization server metadata for the remote MCP (G11, contract stage). */
export function GET(request: Request) {
  if (!remoteMcpEnabled()) return new NextResponse(null, { status: 404 });
  return NextResponse.json(authorizationServerMetadata(new URL(request.url).origin), { headers: { "Cache-Control": "no-store" } });
}
