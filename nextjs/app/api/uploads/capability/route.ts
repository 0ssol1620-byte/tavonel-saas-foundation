import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { reserveFoundationCompute } from "@/lib/compute-reservation";
import { reserveFoundationIntake } from "@/lib/intake-admission";
import { validateQualifiedDocumentInput } from "@/lib/qualified-input";
import { FOUNDATION_INTAKE_MAX_BYTES, presignFoundationQuarantinePut } from "@/lib/r2-presign";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { deterministicSourceDocumentId, validSourceIdempotencyKey } from "@/lib/source-intake";

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

  const auth = await authorizeFoundationRequest(request, "documents:intake", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });

  let body: { originalFilename?: unknown; declaredMimeType?: unknown; requestedBytes?: unknown; estimatedPages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "METADATA_ONLY_ENDPOINT" }, { status: 415, headers: { "Cache-Control": "no-store" } });
  }

  const originalFilename = typeof body.originalFilename === "string" ? body.originalFilename : "";
  const declaredMimeType = typeof body.declaredMimeType === "string" ? body.declaredMimeType : "";
  const requestedBytes = typeof body.requestedBytes === "number" ? body.requestedBytes : Number.NaN;
  const estimatedPages = typeof body.estimatedPages === "number" ? body.estimatedPages : Number.NaN;
  if (!Number.isSafeInteger(requestedBytes) || requestedBytes <= 0 || requestedBytes > FOUNDATION_INTAKE_MAX_BYTES) {
    return NextResponse.json({ code: "UNQUALIFIED_INPUT" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const qualified = validateQualifiedDocumentInput({ originalFilename, declaredMimeType });
  if (!qualified.valid) {
    return NextResponse.json({ code: qualified.code }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const workspaceId = auth.principal.workspaceKey;
  const signer = readR2SignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const sourceIdempotencyKey = request.headers.get("x-tavonel-source-idempotency-key");
  if (sourceIdempotencyKey !== null && !validSourceIdempotencyKey(sourceIdempotencyKey)) {
    return NextResponse.json({ code: "SOURCE_IDEMPOTENCY_KEY_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const documentId = sourceIdempotencyKey
    ? await deterministicSourceDocumentId(workspaceId, sourceIdempotencyKey)
    : crypto.randomUUID();
  const objectKey = `quarantine/${workspaceId}/${documentId}/source`;
  const admission = await reserveFoundationIntake({
    workspaceKey: workspaceId,
    documentId,
    userId: auth.principal.userId,
    objectKey,
    requestedBytes,
    declaredMimeType: qualified.normalizedMimeType,
  });
  if (!admission.ok) {
    const rateLimited = admission.code === "INTAKE_RATE_LIMITED" || admission.code === "INTAKE_DAILY_QUOTA_EXCEEDED";
    const conflict = admission.code === "INTAKE_IDEMPOTENCY_CONFLICT";
    return NextResponse.json(
      { code: admission.code },
      {
        status: rateLimited ? 429 : conflict ? 409 : 503,
        headers: {
          "Cache-Control": "no-store",
          ...(rateLimited ? { "Retry-After": admission.code === "INTAKE_RATE_LIMITED" ? "60" : "3600" } : {}),
        },
      },
    );
  }
  const compute = await reserveFoundationCompute({
    workspaceKey: workspaceId,
    documentId,
    userId: auth.principal.userId,
    estimatedPages,
  });
  if (!compute.ok) {
    const paymentRequired = compute.code === "STUDIO_SUBSCRIPTION_REQUIRED" || compute.code === "GPU_CREDITS_REQUIRED";
    const conflict = compute.code === "COMPUTE_IDEMPOTENCY_CONFLICT";
    return NextResponse.json(
      { code: compute.code },
      { status: paymentRequired ? 402 : conflict ? 409 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }
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
    sourceIdempotency: sourceIdempotencyKey ? "stable" : "none",
    admissionExpiresAt: admission.result.expiresAt,
    computeReservation: {
      reservationId: compute.result.reservationId,
      reservedCredits: compute.result.reservedCredits,
      expiresAt: compute.result.expiresAt,
      quote: compute.result.quote,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
