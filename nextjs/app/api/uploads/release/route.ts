import { NextResponse } from "next/server";
import { cancelFoundationIntakeApprovedFile, readFoundationIntakeApproval } from "@/lib/compute-reservation";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { DOCUMENT_ID_PATTERN } from "@/lib/immutable-keys";
import { headFoundationQuarantineObject, readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { ATTEMPT_KEY_PATTERN, FILE_KEY_PATTERN } from "@/lib/intake-approval";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 1_024) {
    return NextResponse.json({ code: "UPLOAD_RELEASE_REQUEST_TOO_LARGE" }, { status: 413, headers });
  }
  const auth = await authorizeFoundationRequest(request, "documents:intake", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers });

  let body: { documentId?: unknown; attemptKey?: unknown; fileKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "UPLOAD_RELEASE_BODY_INVALID" }, { status: 400, headers });
  }
  const documentId = typeof body.documentId === "string" ? body.documentId : "";
  if (!DOCUMENT_ID_PATTERN.test(documentId)) {
    return NextResponse.json({ code: "UPLOAD_RELEASE_BODY_INVALID" }, { status: 400, headers });
  }
  const attemptKey = typeof body.attemptKey === "string" ? body.attemptKey : "";
  const fileKey = typeof body.fileKey === "string" ? body.fileKey : "";
  if (!ATTEMPT_KEY_PATTERN.test(attemptKey) || !FILE_KEY_PATTERN.test(fileKey)) {
    return NextResponse.json({ code: "INTAKE_APPROVAL_REQUIRED" }, { status: 428, headers });
  }
  const approval = await readFoundationIntakeApproval({
    workspaceKey: auth.principal.workspaceKey, userId: auth.principal.userId, attemptKey,
  });
  if (!approval.ok) return NextResponse.json({ code: approval.code }, { status: approval.status, headers });
  const member = approval.result.files.find((file) => file.fileKey === fileKey);
  if (!member || member.documentId !== documentId) return NextResponse.json({ code: "INTAKE_APPROVAL_SCOPE_MISMATCH" }, { status: 409, headers });

  const signer = readR2SignerEnv();
  if (!signer) return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers });
  const object = await headFoundationQuarantineObject(signer, auth.principal.workspaceKey, documentId);
  if (!object.ok) return NextResponse.json({ code: object.code }, { status: 503, headers });
  if (object.exists) {
    return NextResponse.json({ code: "UPLOAD_ALREADY_STORED" }, { status: 409, headers });
  }

  const released = await cancelFoundationIntakeApprovedFile({
    workspaceKey: auth.principal.workspaceKey, userId: auth.principal.userId,
    attemptKey, fileKey, documentId, reasonCode: "UPLOAD_TRANSFER_FAILED",
  });
  if (!released.ok) return NextResponse.json({ code: released.code }, { status: 503, headers });
  return NextResponse.json({ code: "UPLOAD_CREDITS_RELEASED", result: released.result }, { headers });
}
