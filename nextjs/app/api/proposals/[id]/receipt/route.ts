import { NextResponse } from "next/server";
import { readProposalReceipt, requireProposalSession } from "@/lib/change-proposals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  The signed receipt of one proposal (WO-AN-10), session only: an API key or an agent credential never reads it.
  Only the signed receipt leaves the server (it verifies offline); the stored outcome record, which names the
  person who decided, does not. A proposal of another workspace, an unknown or malformed id, one the viewer can no
  longer read and one without a signed receipt are the same 404 body. Every answer is uncacheable.
*/
const HEADERS = { "Cache-Control": "no-store" } as const;
const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: HEADERS });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireProposalSession(request);
  if (!session.ok) return fail(session.code, session.status);
  const { id } = await context.params;
  const found = await readProposalReceipt(session.principal, id);
  if (!found.ok) return fail(found.code, found.status);
  return new NextResponse(JSON.stringify(found.receipt), {
    headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="receipt-${id}.json"` },
  });
}
