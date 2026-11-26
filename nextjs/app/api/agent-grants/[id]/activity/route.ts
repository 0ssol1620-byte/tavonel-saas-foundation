import { NextResponse } from "next/server";
import { listGrantActivity } from "@/lib/change-proposals";
import { requireFoundationRevokeSession } from "@/lib/developer-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  What one agent grant proposed (WO-AN-10): its proposals, newest first, a page at a time (`?cursor=` as returned
  in `nextCursor`). Session only, never behind the flag and never plan-gated (like the list of grants: a person
  must always be able to see what their agent did). Only the person who made the grant reads it; any other id is
  the same 404. `?format=ndjson` answers the same page as one JSON object per line, as a download, with the next
  cursor in `X-Next-Cursor`. A row names its type, state, times and whether a signed receipt exists; never a
  preview, a document id, a principal or a digest.
*/
const NO_STORE = { "Cache-Control": "no-store" } as const;
const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: NO_STORE });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireFoundationRevokeSession(request);
  if (!auth.ok) return fail(auth.code, auth.status);
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const format = params.get("format");
  if (format !== null && format !== "ndjson") return fail("PROPOSAL_REQUEST_INVALID", 400);
  const activity = await listGrantActivity(auth.principal, id, params.get("cursor"));
  if (!activity.ok) return fail(activity.code, activity.status);
  if (format === "ndjson") {
    return new NextResponse(activity.rows.map((row) => `${JSON.stringify(row)}\n`).join(""), {
      headers: {
        ...NO_STORE, "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": `attachment; filename="agent-activity-${id}.ndjson"`,
        ...(activity.nextCursor ? { "X-Next-Cursor": activity.nextCursor } : {}),
      },
    });
  }
  return NextResponse.json({ code: "OK", activity: activity.rows, nextCursor: activity.nextCursor }, { headers: NO_STORE });
}
