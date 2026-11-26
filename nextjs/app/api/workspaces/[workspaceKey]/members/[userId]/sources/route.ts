import { NextResponse } from "next/server";
import { readMemberSourceScope, setMemberSourceScope } from "@/lib/member-source-scope";
import { requireWorkspaceMembership, revalidateWorkspaceMembership } from "@/lib/workspace-membership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };
type Context = { params: Promise<{ workspaceKey: string; userId: string }> };

/*
  WO-C-T3: which sources one member may read. Owner or admin only, and the database repeats that,
  and refuses an owner/admin as the target (they read every source). A member with no scope reads
  nothing (TC-D1). A write is effective for the member's next request: every read path asks the
  database, nothing is cached and no background job stands in between.

  The DTOs below are the public shape; the store's answer is a different type (member-source-scope).
  The Idempotency-Key is the database's request id for this member: a repeat replays what it did and
  never writes again (a late retry cannot undo a later revoke); the same key with another body is a 409.
*/
type PublicMemberSourceScope = { userId: string; kind: "none" | "all" | "listed"; documentIds: string[] };
type PublicMemberSourceScopeWrite = { userId: string; kind: "all" | "listed"; documentCount: number };

const MAX_BODY_BYTES = 100_000;
const MAX_DOCUMENTS = 2_000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const DOCUMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: NO_STORE });

export async function GET(request: Request, context: Context) {
  const { workspaceKey, userId } = await context.params;
  const auth = await requireWorkspaceMembership(request, workspaceKey, ["owner", "admin"]);
  if (!auth.ok) return fail(auth.code, auth.status);
  const read = await readMemberSourceScope({ workspaceKey, actorUserId: auth.principal.userId, memberUserId: userId });
  if (!read.ok) return fail(read.code, read.status);
  const scope: PublicMemberSourceScope = { userId: read.scope.userId, kind: read.scope.kind, documentIds: read.scope.documentIds };
  return NextResponse.json({ code: "MEMBER_SOURCE_SCOPE", scope }, { headers: NO_STORE });
}

/** Body: {"kind":"all"} or {"kind":"listed","documentIds":[...]} (at most 2,000 ids); header Idempotency-Key. */
export async function PUT(request: Request, context: Context) {
  const { workspaceKey, userId } = await context.params;
  const auth = await requireWorkspaceMembership(request, workspaceKey, ["owner", "admin"]);
  if (!auth.ok) return fail(auth.code, auth.status);
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return fail("IDEMPOTENCY_KEY_INVALID", 400);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return fail("REQUEST_TOO_LARGE", 413);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return fail("REQUEST_TOO_LARGE", 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return fail("INVALID_JSON", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("MEMBER_SOURCE_SCOPE_INPUT_INVALID", 400);
  const fields = body as Record<string, unknown>;
  const keys = Object.keys(fields).sort().join(",");
  let documentIds: string[];
  let kind: "all" | "listed";
  if (fields.kind === "all" && keys === "kind") {
    kind = "all";
    documentIds = [];
  } else if (fields.kind === "listed" && keys === "documentIds,kind" && Array.isArray(fields.documentIds) &&
      fields.documentIds.length <= MAX_DOCUMENTS && fields.documentIds.every((id) => typeof id === "string" && DOCUMENT_ID.test(id))) {
    kind = "listed";
    documentIds = fields.documentIds as string[];
  } else {
    return fail("MEMBER_SOURCE_SCOPE_INPUT_INVALID", 400);
  }
  const written = await setMemberSourceScope({
    workspaceKey, actorUserId: auth.principal.userId, memberUserId: userId,
    kind, documentIds, requestId: `scope-put:${idempotencyKey}`,
  });
  if (!written.ok) return fail(written.code, written.status);
  const current = await revalidateWorkspaceMembership(request, auth.principal, ["owner", "admin"]);
  if (!current.ok) return fail(current.code, current.status);
  const scope: PublicMemberSourceScopeWrite = { userId: written.scope.userId, kind: written.scope.kind, documentCount: written.scope.documentCount };
  return NextResponse.json({ code: "MEMBER_SOURCE_SCOPE_SET", scope, idempotentReplay: written.scope.idempotentReplay }, { headers: NO_STORE });
}
