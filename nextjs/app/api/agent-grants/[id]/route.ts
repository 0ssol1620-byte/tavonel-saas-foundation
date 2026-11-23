import { NextResponse } from "next/server";
import { AGENT_GRANT_STATUS, revokeAgentGrant } from "@/lib/agent-grants";
import { requireFoundationRevokeSession } from "@/lib/developer-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/*
  DELETE /api/agent-grants/{id} -- Disconnect (workorders/agent-native.md §1 step 10, §2.1, §2.5).

  The grant, its credential and its open proposals end in one transaction. Works with the feature
  flag off and is never plan-gated: revocation never waits (developer-auth requireFoundationRevokeSession).
  Only the person who made the grant can disconnect it; any other id -- another person's, another
  workspace's, an absent, malformed or already-revoked one -- is the same 404.
*/
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireFoundationRevokeSession(request);
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  const result = await revokeAgentGrant(auth.principal.workspaceKey, auth.principal.userId, id);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: AGENT_GRANT_STATUS[result.code], headers: NO_STORE });
  return NextResponse.json({
    code: "REVOKED",
    revokedAt: result.revokedAt,
    keysRevoked: result.keysRevoked,
    proposalsWithdrawn: result.proposalsWithdrawn,
  }, { headers: NO_STORE });
}
