import { NextResponse } from "next/server";
import { checkConnectorSourceAccessForViewer } from "@/lib/connector-source-access";
import { requireFoundationSession } from "@/lib/developer-auth";
import { decideLibraryLabel } from "@/lib/library-shadow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
  A person's decision on a Library label (WO-D23-4), session only: an API key is refused even with
  scopes, because a decision is a person's act. The viewer must be able to read the document now.
  It appends one row; it never deletes or edits a source, and undo is the opposite decision.
*/
const HEADERS = { "Cache-Control": "no-store" } as const;
const MAX_BODY_BYTES = 2_048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: HEADERS });

export async function POST(request: Request) {
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return fail(auth.code, auth.status);
  if (auth.principal.kind !== "session") return fail("LIBRARY_DECISION_SESSION_REQUIRED", 403);
  const raw = await request.text().catch(() => null);
  if (raw === null || raw.length > MAX_BODY_BYTES) return fail("LIBRARY_DECISION_REQUEST_INVALID", raw === null ? 400 : 413);
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch { /* an unreadable body is the same refusal as a body with the wrong fields */ }
  const { documentId, sourceVersionId, labelKind, labelKey, decision, idempotencyKey } = body;
  if (typeof documentId !== "string" || typeof sourceVersionId !== "string" || (labelKind !== "doc_type" && labelKind !== "topic")
    || typeof labelKey !== "string" || (decision !== "confirmed" && decision !== "rejected") || typeof idempotencyKey !== "string") {
    return fail("LIBRARY_DECISION_REQUEST_INVALID", 400);
  }
  if (!UUID.test(documentId.toLowerCase())) return fail("LIBRARY_DECISION_REQUEST_INVALID", 400);
  const { workspaceKey, userId } = auth.principal;
  // The decision store re-checks every field; the id is checked here only so a malformed one never reaches the access check.
  const access = await checkConnectorSourceAccessForViewer(workspaceKey, [documentId.toLowerCase()], userId);
  if (!access.ok) return fail(access.code, access.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503);
  const decided = await decideLibraryLabel(workspaceKey,
    { documentId, sourceVersionId, labelKind, labelKey, decision, idempotencyKey }, userId);
  if (!decided.ok) return fail(decided.code, decided.status);
  return NextResponse.json({ code: "OK", replayed: decided.replayed }, { headers: HEADERS });
}
