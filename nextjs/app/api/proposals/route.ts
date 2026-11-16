import { NextResponse } from "next/server";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { createProposal, filterReadableProposals, listProposals, readJsonObject, requireProposalSession, toPublicProposal } from "@/lib/change-proposals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  Change proposals (WO-D30-2), session only: an API key is refused with 403 even with scopes.
  POST creates a proposal bound to the active World and mutates nothing else; it needs an
  Idempotency-Key header, and the same key with the same body returns the first proposal.
  GET lists only the proposals whose document the viewer can read now, each document checked once;
  an access check that cannot answer is a 503, never a list. Every answer is uncacheable, refusals included.
*/
const HEADERS = { "Cache-Control": "no-store" } as const;
const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: HEADERS });

export async function GET(request: Request) {
  const session = await requireProposalSession(request);
  if (!session.ok) return fail(session.code, session.status);
  const collectionId = new URL(request.url).searchParams.get("collectionId") ?? "";
  if (!COLLECTION_ID_PATTERN.test(collectionId)) return fail("PROPOSAL_REQUEST_INVALID", 400);
  const listed = await listProposals(session.principal.workspaceKey, collectionId);
  if (!listed.ok) return fail(listed.code, listed.status);
  const readable = await filterReadableProposals(session.principal, listed.rows);
  if (!readable.ok) return fail(readable.code, readable.status);
  return NextResponse.json({ code: "OK", proposals: readable.rows.map((row) => toPublicProposal(row, true)) }, { headers: HEADERS });
}

export async function POST(request: Request) {
  const session = await requireProposalSession(request);
  if (!session.ok) return fail(session.code, session.status);
  const body = await readJsonObject(request);
  const { collectionId, actionType, input, evidenceIds } = body ?? {};
  if (!body || typeof collectionId !== "string" || typeof actionType !== "string") return fail("PROPOSAL_REQUEST_INVALID", 400);
  const created = await createProposal(session.principal, {
    collectionId, actionType, input, evidenceIds, idempotencyKey: request.headers.get("idempotency-key") ?? "",
  });
  if (!created.ok) return fail(created.code, created.status);
  return NextResponse.json({ code: "OK", replayed: created.replayed, proposal: created.proposal },
    { status: created.replayed ? 200 : 201, headers: HEADERS });
}
