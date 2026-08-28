import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { validateQualifiedDocumentInput } from "@/lib/qualified-input";
import { FOUNDATION_INTAKE_MAX_BYTES, presignFoundationQuarantinePut } from "@/lib/r2-presign";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json") || !Number.isFinite(contentLength) || contentLength > 8_192) {
    return NextResponse.json({ code: "METADATA_ONLY_ENDPOINT" }, { status: 415, headers: { "Cache-Control": "no-store" } });
  }
  if (!activationPolicy.customerIntake.enabled) {
    return NextResponse.json({ code: "INTAKE_DISABLED", reason: activationPolicy.customerIntake.reason }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  let body: { originalFilename?: unknown; declaredMimeType?: unknown; requestedBytes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "METADATA_ONLY_ENDPOINT" }, { status: 415, headers: { "Cache-Control": "no-store" } });
  }

  const originalFilename = typeof body.originalFilename === "string" ? body.originalFilename : "";
  const declaredMimeType = typeof body.declaredMimeType === "string" ? body.declaredMimeType : "";
  const requestedBytes = typeof body.requestedBytes === "number" ? body.requestedBytes : Number.NaN;
  if (!Number.isSafeInteger(requestedBytes) || requestedBytes <= 0 || requestedBytes > FOUNDATION_INTAKE_MAX_BYTES) {
    return NextResponse.json({ code: "UNQUALIFIED_INPUT" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const qualified = validateQualifiedDocumentInput({ originalFilename, declaredMimeType });
  if (!qualified.valid) {
    return NextResponse.json({ code: qualified.code }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const { membership } = foundationPilotAccess(user.id);
  const signer = readR2SignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const documentId = crypto.randomUUID();
  const objectKey = `quarantine/${membership.workspaceId}/${documentId}/source`;
  const signed = presignFoundationQuarantinePut(signer, {
    key: objectKey,
    contentType: qualified.normalizedMimeType,
    contentLength: requestedBytes,
    expiresInSeconds: 300,
  });
  if (!signed.ok) {
    return NextResponse.json({ code: signed.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({
    code: "QUALIFIED",
    documentId,
    objectKey,
    uploadUrl: signed.uploadUrl,
    expiresInSeconds: 300,
    contentLength: requestedBytes,
    originalFilename: qualified.originalFilename,
    declaredMimeType: qualified.normalizedMimeType,
    sanitization: "pending_cdr",
  }, { headers: { "Cache-Control": "no-store" } });
}
