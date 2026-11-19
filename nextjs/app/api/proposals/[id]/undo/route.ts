import { NextResponse } from "next/server";
import { getProposal, readJsonObject, requireProposalSession, undoProposal } from "@/lib/change-proposals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// = DECISION_MAX_DURATION_S (lib/agent-access.ts); a literal because Next reads it statically. A test pins the two equal.
export const maxDuration = 120;

/*
  Undo of an executed proposal (WO-D30-2, WO-AN-2), session only, looked up by id; a `collectionId` in the
  body is accepted and ignored. Only a type with an undo (library_label) is undoable. It issues the opposite
  library decision and records `undone`; a second Undo is refused with 409, and an Undo the library refuses
  as stale records nothing and leaves the proposal `executed`.
*/
const HEADERS = { "Cache-Control": "no-store" } as const;
const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: HEADERS });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireProposalSession(request);
  if (!session.ok) return fail(session.code, session.status);
  const body = await readJsonObject(request);
  if (!body) return fail("PROPOSAL_REQUEST_INVALID", 400);
  const found = await getProposal(session.principal.workspaceKey, (await context.params).id);
  if (!found.ok) return fail(found.code, found.status);
  const undone = await undoProposal(request, session.principal, found.row);
  if (!undone.ok) return fail(undone.code, undone.status);
  return NextResponse.json({ code: "OK", proposal: undone.proposal }, { headers: HEADERS });
}
