import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { reserveFoundationCompute } from "@/lib/compute-reservation";
import { reserveFoundationIntake } from "@/lib/intake-admission";
import { validateQualifiedDocumentInput } from "@/lib/qualified-input";
import { FOUNDATION_INTAKE_MAX_BYTES, presignFoundationQuarantinePut } from "@/lib/r2-presign";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { deterministicSourceDocumentId, validSourceIdempotencyKey } from "@/lib/source-intake";
import { estimateBillablePages } from "@/lib/usage-pricing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json") || !Number.isFinite(contentLength) || contentLength > 8_192) {
    return NextResponse.json({ code: "METADATA_ONLY_ENDPOINT" }, { status: 415, headers: NO_STORE });
  }
  if (!activationPolicy.customerIntake.enabled) {
    return NextResponse.json({ code: "INTAKE_DISABLED", reason: activationPolicy.customerIntake.reason }, { status: 503, headers: { ...NO_STORE, "Retry-After": "60" } });
  }

  const auth = await authorizeFoundationRequest(request, "documents:intake", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });

  let body: { originalFilename?: unknown; declaredMimeType?: unknown; requestedBytes?: unknown; estimatedPages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "METADATA_ONLY_ENDPOINT" }, { status: 415, headers: NO_STORE });
  }

  const originalFilename = typeof body.originalFilename === "string" ? body.originalFilename : "";
  const declaredMimeType = typeof body.declaredMimeType === "string" ? body.declaredMimeType : "";
  const requestedBytes = typeof body.requestedBytes === "number" ? body.requestedBytes : Number.NaN;
  if (!Number.isSafeInteger(requestedBytes) || requestedBytes <= 0 || requestedBytes > FOUNDATION_INTAKE_MAX_BYTES) {
    return NextResponse.json({ code: "UNQUALIFIED_INPUT" }, { status: 400, headers: NO_STORE });
  }

  // ZIP is a paid/owner intake convenience. A direct archive can never be smuggled through a
  // free evaluation. Browser-expanded archives are still bounded by the database's three-file
  // trial cap and free-compute budget, so a client cannot use expansion to escape the cost gate.
  if (auth.principal.accessSource === "trial" && /\.zip$/i.test(originalFilename)) {
    return NextResponse.json({ code: "TRIAL_ARCHIVE_NOT_INCLUDED" }, { status: 402, headers: NO_STORE });
  }

  const qualified = validateQualifiedDocumentInput({ originalFilename, declaredMimeType });
  if (!qualified.valid) {
    return NextResponse.json({ code: qualified.code }, { status: 400, headers: NO_STORE });
  }

  // The client may provide a better preflight count, but it can never lower the server's own
  // conservative reservation. This closes the trivial "send estimatedPages: 1" path before any
  // OCR/GPU capability is issued.
  const serverEstimate = estimateBillablePages({
    bytes: requestedBytes,
    mimeType: qualified.normalizedMimeType,
  })?.pages ?? 1;
  const clientEstimate = typeof body.estimatedPages === "number" && Number.isSafeInteger(body.estimatedPages)
    && body.estimatedPages >= 1 ? body.estimatedPages : serverEstimate;
  const reservationPages = Math.max(serverEstimate, clientEstimate);

  const workspaceId = auth.principal.workspaceKey;
  const signer = readR2SignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  }

  const sourceIdempotencyKey = request.headers.get("x-tavonel-source-idempotency-key");
  if (sourceIdempotencyKey !== null && !validSourceIdempotencyKey(sourceIdempotencyKey)) {
    return NextResponse.json({ code: "SOURCE_IDEMPOTENCY_KEY_INVALID" }, { status: 400, headers: NO_STORE });
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
    const trialLimited = admission.code === "TRIAL_FILE_LIMIT_EXCEEDED" || admission.code === "TRIAL_NOT_ACTIVE";
    const conflict = admission.code === "INTAKE_IDEMPOTENCY_CONFLICT";
    return NextResponse.json(
      { code: admission.code },
      {
        status: rateLimited ? 429 : trialLimited ? 402 : conflict ? 409 : 503,
        headers: {
          ...NO_STORE,
          ...(rateLimited ? { "Retry-After": admission.code === "INTAKE_RATE_LIMITED" ? "60" : "3600" } : {}),
        },
      },
    );
  }
  const compute = await reserveFoundationCompute({
    workspaceKey: workspaceId,
    documentId,
    userId: auth.principal.userId,
    estimatedPages: reservationPages,
  });
  if (!compute.ok) {
    const paymentRequired = [
      "STUDIO_SUBSCRIPTION_REQUIRED",
      "GPU_CREDITS_REQUIRED",
      "TRIAL_PAGE_LIMIT_EXCEEDED",
      "TRIAL_NOT_ACTIVE",
      "TRIAL_DISABLED",
    ].includes(compute.code);
    const capacity = compute.code === "TRIAL_CAPACITY_REACHED";
    const conflict = compute.code === "COMPUTE_IDEMPOTENCY_CONFLICT";
    return NextResponse.json(
      { code: compute.code },
      {
        status: capacity ? 429 : paymentRequired ? 402 : conflict ? 409 : 503,
        headers: { ...NO_STORE, ...(capacity ? { "Retry-After": "86400" } : {}) },
      },
    );
  }
  const signed = presignFoundationQuarantinePut(signer, {
    key: objectKey,
    contentType: qualified.normalizedMimeType,
    contentLength: requestedBytes,
    expiresInSeconds: 300,
  });
  if (!signed.ok) {
    return NextResponse.json({ code: signed.code }, { status: 503, headers: NO_STORE });
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
      billingSource: compute.result.billingSource,
      expiresAt: compute.result.expiresAt,
      quote: compute.result.quote,
    },
  }, { headers: NO_STORE });
}
