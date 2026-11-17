import { NextResponse } from "next/server";
import { decideProposal, getProposal, readJsonObject, requireProposalSession } from "@/lib/change-proposals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// = DECISION_MAX_DURATION_S (lib/agent-access.ts); a literal because Next reads it statically. A test pins the two equal.
export const maxDuration = 120;

/*
  A person's decision on a proposal (WO-D30-2, WO-AN-2), session only: no API key, MCP or agent credential
  can confirm. The proposal is looked up by id; a `collectionId` in the body is accepted and ignored.
  Body {decision: "confirm", previewDigest} or {decision: "reject"}. A confirmation executes the proposal
  once, in the store's order: expired, withdrawn, stale, then confirmed. The answer carries the state the
  store settled on; `stale`, `expired`, `withdrawn`, `rejected`, `executed` and `failed` are all 200.
*/
const HEADERS = { "Cache-Control": "no-store" } as const;
const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: HEADERS });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireProposalSession(request);
  if (!session.ok) return fail(session.code, session.status);
  const body = await readJsonObject(request);
  if (!body || (body.decision !== "confirm" && body.decision !== "reject")) return fail("PROPOSAL_REQUEST_INVALID", 400);
  const found = await getProposal(session.principal.workspaceKey, (await context.params).id);
  if (!found.ok) return fail(found.code, found.status);
  const decided = await decideProposal(request, session.principal, found.row, { decision: body.decision, previewDigest: body.previewDigest });
  if (!decided.ok) return fail(decided.code, decided.status);
  return NextResponse.json({ code: "OK", proposal: decided.proposal }, { headers: HEADERS });
}
