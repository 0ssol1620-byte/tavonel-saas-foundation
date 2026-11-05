import { NextResponse } from "next/server";
import { revokeAllRemoteMcpKeys } from "@/lib/developer-store";
import { authorizeSyntheticCanary } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };

function authorized(request: Request): boolean {
  const configured = [process.env.FOUNDATION_WORKER_SECRET, process.env.CRON_SECRET]
    .map(value => value?.trim() ?? "")
    .filter(value => value.length >= 32);
  return configured.some(secret => authorizeSyntheticCanary(request.headers.get("authorization"), secret));
}

/*
  POST /api/internal/remote-mcp/revoke-all -- the remote MCP's immediate rollback lever (review R1 M4).

  An env change reaches a Vercel deployment only through a new build, so turning the MCP switch off
  is not immediate. This is: it revokes every live `MCP: ` key in every workspace in one write, and
  the next call with any of them is refused (authentication reads the key row on every call). It
  works with the MCP switch on or off. POST only, so a cron GET can never fire it. Hand-made keys
  are untouched: no hand-made key may carry the `MCP: ` name.

  No developer audit row: that table needs a member or a key as actor and an operator is neither.
  The response (counts per workspace) and the log line are the record; keep the response.
*/
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ code: "REMOTE_MCP_REVOKE_NOT_AUTHORIZED" }, { status: 401, headers: HEADERS });
  const result = await revokeAllRemoteMcpKeys();
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: HEADERS });
  console.info(JSON.stringify({ event: "remote_mcp_keys_revoked_in_bulk", revoked: result.revoked, revokedAt: result.revokedAt }));
  return NextResponse.json({ code: "REVOKED", revoked: result.revoked, byWorkspace: result.byWorkspace, revokedAt: result.revokedAt }, { headers: HEADERS });
}
