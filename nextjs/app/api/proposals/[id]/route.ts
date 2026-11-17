import { NextResponse } from "next/server";
import { filterReadableProposals, getProposal, requireProposalSession, toPublicProposal } from "@/lib/change-proposals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  One proposal by id (WO-AN-2), session only: the deep link of the inbox. A proposal of another workspace,
  an unknown id, a type without an executor, an input that does not parse, or one naming a document the
  viewer cannot read now are all the same 404 body. An access check that cannot answer is a 503.
*/
const HEADERS = { "Cache-Control": "no-store" } as const;
const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: HEADERS });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireProposalSession(request);
  if (!session.ok) return fail(session.code, session.status);
  const found = await getProposal(session.principal.workspaceKey, (await context.params).id);
  if (!found.ok) return fail(found.code, found.status);
  const readable = await filterReadableProposals(session.principal, [found.row]);
  if (!readable.ok) return fail(readable.code, readable.status);
  const row = readable.rows[0];
  const proposal = row ? toPublicProposal(row, { userId: session.principal.userId, now: new Date() }, true) : null;
  if (!proposal) return fail("PROPOSAL_NOT_FOUND", 404);
  return NextResponse.json({ code: "OK", proposal }, { headers: HEADERS });
}
