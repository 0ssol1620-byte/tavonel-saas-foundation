import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { readBoundedJson } from "@/lib/enterprise-http";
import {
  cancelFoundationIntakeApprovedFile,
  readFoundationIntakeApproval,
} from "@/lib/compute-reservation";
import { ATTEMPT_KEY_PATTERN, FILE_KEY_PATTERN, SHA256_DIGEST_PATTERN } from "@/lib/intake-approval";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeFoundationRequest(request, "documents:intake", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const parsed = await readBoundedJson(request, 1024);
  if (!parsed.ok) return NextResponse.json({ code: "INTAKE_APPROVAL_CANCEL_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const body = parsed.value as { attemptKey?: unknown; scopeDigest?: unknown; fileKey?: unknown };
  if (typeof body.attemptKey !== "string" || !ATTEMPT_KEY_PATTERN.test(body.attemptKey)
    || typeof body.scopeDigest !== "string" || !SHA256_DIGEST_PATTERN.test(body.scopeDigest)
    || typeof body.fileKey !== "string" || !FILE_KEY_PATTERN.test(body.fileKey)) {
    return NextResponse.json({ code: "INTAKE_APPROVAL_CANCEL_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const lookup = await readFoundationIntakeApproval({
    workspaceKey: auth.principal.workspaceKey, userId: auth.principal.userId, attemptKey: body.attemptKey,
  });
  if (!lookup.ok) return NextResponse.json({ code: lookup.code }, { status: lookup.status, headers: { "Cache-Control": "no-store" } });
  if (lookup.result.scopeDigest !== body.scopeDigest) {
    return NextResponse.json({ code: "INTAKE_APPROVAL_CONFLICT" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const member = lookup.result.files.find((entry) => entry.fileKey === body.fileKey);
  if (!member) return NextResponse.json({ code: "INTAKE_APPROVAL_FILE_OUT_OF_SCOPE" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const cancelled = await cancelFoundationIntakeApprovedFile({
    workspaceKey: auth.principal.workspaceKey, userId: auth.principal.userId,
    attemptKey: body.attemptKey, fileKey: body.fileKey, documentId: member.documentId,
    reasonCode: "DEPENDENT_MEMBER_FAILED",
  });
  if (!cancelled.ok) return NextResponse.json({ code: cancelled.code }, { status: cancelled.status, headers: { "Cache-Control": "no-store" } });
  const reconciliationRequired = cancelled.result.reconciliationRequired === true;
  return NextResponse.json({
    code: reconciliationRequired ? "INTAKE_SET_CANCELLED_RECONCILIATION_REQUIRED" : "INTAKE_SET_CANCELLED",
    result: cancelled.result,
  }, { headers: { "Cache-Control": "no-store" } });
}
