import { NextResponse } from "next/server";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import {
  createProposal, filterReadableProposals, listProposals, listProposalsPage, readJsonObject, requireProposalSession, sessionActor,
  toPublicProposal, type ProposalRow, type PublicProposal,
} from "@/lib/change-proposals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  Change proposals (WO-D30-2, WO-AN-2), session only: an API key is refused with 403 even with scopes.
  POST creates a proposal and mutates nothing else; it needs an Idempotency-Key header, and the same key
  with the same body returns the first proposal.
  GET ?collectionId= lists that collection's newest proposals; GET without it is the workspace inbox, one
  page at a time (`?cursor=` as returned in `nextCursor`). Either way a proposal is listed only when its type
  is known, its input parses and the viewer can read every document it names now; rows are filtered before
  the page is cut. An access check that cannot answer is a 503, never a list. Every answer is uncacheable.
*/
const HEADERS = { "Cache-Control": "no-store" } as const;
const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: HEADERS });

export async function GET(request: Request) {
  const session = await requireProposalSession(request);
  if (!session.ok) return fail(session.code, session.status);
  const { principal } = session;
  const viewer = { userId: principal.userId, now: new Date() };
  const shown = (rows: ProposalRow[]) => rows.map((row) => toPublicProposal(row, viewer, true)).filter((row): row is PublicProposal => row !== null);
  const params = new URL(request.url).searchParams;
  if (!params.has("collectionId")) {
    const page = await listProposalsPage(principal, { cursor: params.get("cursor") });
    if (!page.ok) return fail(page.code, page.status);
    return NextResponse.json({ code: "OK", proposals: shown(page.rows), nextCursor: page.nextCursor }, { headers: HEADERS });
  }
  const collectionId = params.get("collectionId") ?? "";
  if (!COLLECTION_ID_PATTERN.test(collectionId)) return fail("PROPOSAL_REQUEST_INVALID", 400);
  const listed = await listProposals(principal.workspaceKey, collectionId);
  if (!listed.ok) return fail(listed.code, listed.status);
  const readable = await filterReadableProposals(principal, listed.rows);
  if (!readable.ok) return fail(readable.code, readable.status);
  return NextResponse.json({ code: "OK", proposals: shown(readable.rows) }, { headers: HEADERS });
}

export async function POST(request: Request) {
  const session = await requireProposalSession(request);
  if (!session.ok) return fail(session.code, session.status);
  const body = await readJsonObject(request);
  const { collectionId, actionType, input, evidenceIds } = body ?? {};
  if (!body || typeof collectionId !== "string" || typeof actionType !== "string") return fail("PROPOSAL_REQUEST_INVALID", 400);
  const created = await createProposal(sessionActor(session.principal), {
    actionType, raw: { collectionId, input }, evidenceIds, clientKey: request.headers.get("idempotency-key") ?? "",
  });
  if (!created.ok) return fail(created.code, created.status);
  const proposal = toPublicProposal(created.row, { userId: session.principal.userId, now: new Date() }, true);
  if (!proposal) return fail("PROPOSAL_STORE_RESPONSE_INVALID", 503);
  return NextResponse.json({ code: "OK", replayed: created.replayed, proposal }, { status: created.replayed ? 200 : 201, headers: HEADERS });
}
