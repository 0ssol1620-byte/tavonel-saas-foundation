import { NextResponse } from "next/server";
import { registerClient, remoteMcpEnabled, remoteMcpSealingKey } from "@/lib/remote-mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/*
  POST /api/mcp/oauth/register -- RFC 7591 dynamic client registration for the remote MCP.

  Stateless: the client id is the registration itself, sealed (lib/remote-mcp.ts), so nothing is
  written and an unauthenticated caller can register as often as it likes without filling a
  table. Registration grants nothing; a person still consents in a browser before any code exists.
*/
export async function POST(request: Request) {
  if (!remoteMcpEnabled()) return new NextResponse(null, { status: 404 });
  const key = remoteMcpSealingKey();
  if (!key) return NextResponse.json({ error: "temporarily_unavailable", error_description: "REMOTE_MCP_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  const text = await request.text();
  if (text.length > 8_192) return NextResponse.json({ error: "invalid_client_metadata", error_description: "The registration is too large." }, { status: 400, headers: NO_STORE });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "The registration is not JSON." }, { status: 400, headers: NO_STORE });
  }
  const result = registerClient(body, key);
  if (!result.ok) return NextResponse.json({ error: result.error, error_description: result.error_description }, { status: 400, headers: NO_STORE });
  return NextResponse.json(result.registration, { status: 201, headers: NO_STORE });
}
