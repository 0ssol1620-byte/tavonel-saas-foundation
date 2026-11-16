import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import { readLibraryDocuments } from "@/lib/library-shadow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  The Library for a viewer (WO-D23-4): the public DTO of readLibraryDocuments, session only.

  Disabled (flag off, or a workspace outside the canary cohort) answers 404 {code}, and the panel
  renders nothing. Every answer is uncacheable, refusals included.
*/
const HEADERS = { "Cache-Control": "no-store" } as const;
const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: HEADERS });

const STATUS: Readonly<Record<string, number>> = { LIBRARY_ORGANIZE_NOT_ENABLED: 404, LIBRARY_ORGANIZE_REQUEST_INVALID: 400 };

export async function GET(request: Request) {
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return fail(auth.code, auth.status);
  if (auth.principal.kind !== "session") return fail("LIBRARY_SESSION_REQUIRED", 403);
  const documents = (new URL(request.url).searchParams.get("documents") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const read = await readLibraryDocuments(auth.principal.workspaceKey, [...new Set(documents)], auth.principal.userId);
  if (!read.ok) return fail(read.code, STATUS[read.code] ?? 503);
  return NextResponse.json({ code: "OK", documents: read.documents, sourceVersions: read.sourceVersions }, { headers: HEADERS });
}
