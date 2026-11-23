import { NextResponse } from "next/server";
import { revokeAllAgentGrants } from "@/lib/agent-grants";
import { authorizeSyntheticCanary } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };

// The secret check of app/api/internal/remote-mcp/revoke-all/route.ts, copied: closed when neither secret is set.
function authorized(request: Request): boolean {
  const configured = [process.env.FOUNDATION_WORKER_SECRET, process.env.CRON_SECRET]
    .map(value => value?.trim() ?? "")
    .filter(value => value.length >= 32);
  return configured.some(secret => authorizeSyntheticCanary(request.headers.get("authorization"), secret));
}

/*
  POST /api/internal/agent-grants/revoke-all -- the agent-proposal kill switch
  (workorders/agent-native.md §2.5, lever 2: immediate, irreversible).

  One transaction (revoke_all_foundation_agent_grants): every agent grant and every `tvnl_agt_`
  credential in every workspace is revoked, every open agent proposal becomes `withdrawn`, and each
  revoked credential gets its own api_key_revoked audit row. After it every agent call is refused and
  no agent-origin proposal can be confirmed; people must connect again. Live developer keys and the
  remote MCP's keys are untouched -- that is the other lever, app/api/internal/remote-mcp/revoke-all.
  Works with the feature flag on or off. POST only, so a cron GET can never fire it.

  The reversible lever is the flag (TAVONEL_AGENT_PROPOSALS_ENABLED unset), which needs a redeploy.
*/
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ code: "AGENT_GRANTS_REVOKE_NOT_AUTHORIZED" }, { status: 401, headers: HEADERS });
  const result = await revokeAllAgentGrants();
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: HEADERS });
  console.info(JSON.stringify({ event: "agent_grants_revoked_in_bulk", grants: result.grants, keys: result.keys, proposals: result.proposals }));
  return NextResponse.json({
    code: "REVOKED",
    grants: result.grants,
    keys: result.keys,
    proposals: result.proposals,
    byWorkspace: result.byWorkspace,
  }, { headers: HEADERS });
}
