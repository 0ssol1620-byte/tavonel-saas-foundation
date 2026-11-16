import { NextResponse } from "next/server";
import { decideProposal, findProposal, readJsonObject, requireProposalSession } from "@/lib/change-proposals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  A person's decision on a proposal (WO-D30-2), session only: no API key or MCP path can confirm.
  Body {collectionId, decision: "confirm" | "reject"}. A confirmation executes the proposal once, in
  the store's order: expired, stale (the active World moved), then confirmed. The answer carries the
  state the store settled on; `stale`, `expired`, `rejected`, `executed` and `failed` are all 200.
*/
const HEADERS = { "Cache-Control": "no-store" } as const;
const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: HEADERS });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireProposalSession(request);
  if (!session.ok) return fail(session.code, session.status);
  const body = await readJsonObject(request);
  if (!body || (body.decision !== "confirm" && body.decision !== "reject")) return fail("PROPOSAL_REQUEST_INVALID", 400);
  const found = await findProposal(session.principal.workspaceKey, body.collectionId, (await context.params).id);
  if (!found.ok) return fail(found.code, found.status);
  const decided = await decideProposal(request, session.principal, found.row, body.decision);
  if (!decided.ok) return fail(decided.code, decided.status);
  return NextResponse.json({ code: "OK", proposal: decided.proposal }, { headers: HEADERS });
}
