import { NextResponse } from "next/server";
import { agentProposalsCohortRefusal, agentProposalsEnabled } from "@/lib/agent-access";
import { AGENT_GRANT_STATUS as STATUS, createAgentGrant, listAgentGrants, normalizeClientLabel } from "@/lib/agent-grants";
import { requireFoundationRevokeSession, requireFoundationSession } from "@/lib/developer-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 1_024;

/*
  Agent access (workorders/agent-native.md §1 step 1, §2.1, §2.5; WO-AN-3).

  GET  lists the grants the signed-in person made in their workspace, revoked ones included. It is
       never behind the flag and never plan-gated: a person must always be able to find what to
       disconnect. No token, no hash, no prefix. `creatable` (WO-REL-5) is whether POST would create a
       grant for this workspace: the same `grantCreatable` POST refuses on, one boolean, never the
       flag's name or the cohort.
  POST creates a grant and its one `tvnl_agt_` credential and answers the token once, `no-store`.
       Flag off, or a workspace outside the cohort: 404, identical to a route that does not exist.
       A free evaluation cannot mint a credential (402), exactly as with developer keys.
*/

const notFound = () => NextResponse.json({ code: "NOT_FOUND" }, { status: 404, headers: NO_STORE });

/** The flag and the cohort: the two facts POST refuses on, and the one GET answers as `creatable`. */
const grantCreatable = (workspaceKey: string) => agentProposalsEnabled() && agentProposalsCohortRefusal(workspaceKey) === null;

/** `{ clientLabel }` and nothing else, at most MAX_BODY_BYTES. Any other shape is a 4xx, never a throw. */
async function readClientLabel(request: Request): Promise<{ ok: true; clientLabel: string } | { ok: false; code: string; status: 400 | 413 }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, code: "REQUEST_TOO_LARGE", status: 413 };
  let text: string;
  try { text = await request.text(); } catch { return { ok: false, code: "INVALID_JSON", status: 400 }; }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return { ok: false, code: "REQUEST_TOO_LARGE", status: 413 };
  let body: unknown;
  try { body = JSON.parse(text); } catch { return { ok: false, code: "INVALID_JSON", status: 400 }; }
  if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join() !== "clientLabel") {
    return { ok: false, code: "AGENT_GRANT_INPUT_INVALID", status: 400 };
  }
  const clientLabel = normalizeClientLabel((body as { clientLabel: unknown }).clientLabel);
  return clientLabel === null ? { ok: false, code: "AGENT_GRANT_INPUT_INVALID", status: 400 } : { ok: true, clientLabel };
}

export async function GET(request: Request) {
  const auth = await requireFoundationRevokeSession(request);
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const result = await listAgentGrants(auth.principal.workspaceKey, auth.principal.userId);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: STATUS[result.code], headers: NO_STORE });
  return NextResponse.json({
    code: "OK", grants: result.grants, truncated: result.truncated, creatable: grantCreatable(auth.principal.workspaceKey),
  }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!agentProposalsEnabled()) return notFound();
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  // Outside the cohort reads exactly like the flag being off. The same function GET answers `creatable` with.
  if (!grantCreatable(auth.principal.workspaceKey)) return notFound();
  if (auth.principal.accessSource === "trial") {
    return NextResponse.json({ code: "TRIAL_FEATURE_NOT_INCLUDED" }, { status: 402, headers: NO_STORE });
  }
  const input = await readClientLabel(request);
  if (!input.ok) return NextResponse.json({ code: input.code }, { status: input.status, headers: NO_STORE });
  const result = await createAgentGrant({
    workspaceKey: auth.principal.workspaceKey,
    userId: auth.principal.userId,
    authorizationRevision: auth.principal.authorizationRevision,
    clientLabel: input.clientLabel,
    grantorEmail: auth.principal.email,
  });
  if (!result.ok) {
    // Busy (the kill switch holds the lock): nothing was created; 2 s is a start value (WO-AN-8).
    const headers = result.code === "AGENT_GRANTS_BUSY_RETRY" ? { ...NO_STORE, "Retry-After": "2" } : NO_STORE;
    return NextResponse.json({ code: result.code }, { status: STATUS[result.code], headers });
  }
  return NextResponse.json({ code: "CREATED", grant: result.grant, token: result.token }, { status: 201, headers: NO_STORE });
}
