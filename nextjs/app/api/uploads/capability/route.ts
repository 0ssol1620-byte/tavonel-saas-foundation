import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { readBoundedJson } from "@/lib/enterprise-http";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { reserveFoundationIntakeApprovedFile, readFoundationIntakeApproval } from "@/lib/compute-reservation";
import { canAdmitCustomerSource } from "@/lib/customer-data-admission";
import { reserveFoundationIntake } from "@/lib/intake-admission";
import { validateQualifiedDocumentInput } from "@/lib/qualified-input";
import {
  FOUNDATION_INTAKE_MAX_BYTES,
  FOUNDATION_TRIAL_INTAKE_MAX_BYTES,
  PROCESSING_CEILING,
  PROCESSING_CEILING_SENTENCE,
  presignFoundationQuarantinePut,
} from "@/lib/r2-presign";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { deterministicSourceDocumentId } from "@/lib/source-intake";
import { intakePricingFingerprint } from "@/lib/usage-pricing";
import { approvedSourceIdempotencyKey, ATTEMPT_KEY_PATTERN, FILE_KEY_PATTERN, SHA256_DIGEST_PATTERN } from "@/lib/intake-approval";

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

  const parsed = await readBoundedJson(request, 8_192);
  if (!parsed.ok) return NextResponse.json({ code: "METADATA_ONLY_ENDPOINT" }, { status: 415, headers: NO_STORE });
  const body = parsed.value as {
    originalFilename?: unknown; declaredMimeType?: unknown; requestedBytes?: unknown; estimatedPages?: unknown;
    attemptKey?: unknown; scopeDigest?: unknown; pricingFingerprint?: unknown; fileKey?: unknown; contentSha256?: unknown;
  };

  const originalFilename = typeof body.originalFilename === "string" ? body.originalFilename : "";
  const declaredMimeType = typeof body.declaredMimeType === "string" ? body.declaredMimeType : "";
  const requestedBytes = typeof body.requestedBytes === "number" ? body.requestedBytes : Number.NaN;
  if (!Number.isSafeInteger(requestedBytes) || requestedBytes <= 0) {
    return NextResponse.json({ code: "UNQUALIFIED_INPUT" }, { status: 400, headers: NO_STORE });
  }
  /*
   * Refuse it here, or drop it silently later. Those are the only two options today.
   *
   * The ceiling is the deployment's, not this route's: the CDR worker and the Cloud Run
   * rasterizer stop at `PROCESSING_CEILING`, and admitting anything larger only moves the
   * refusal somewhere the customer cannot see it. The refusal names the real limit -- bytes and
   * pages -- so it can be acted on rather than merely observed, and `/sources` states the same
   * two numbers from the same module before an upload is ever attempted.
   *
   * The code is new because the old one is no longer true: `FILE_TOO_LARGE` is spelled out as
   * "exceeds the 250 MB direct-upload limit" in the board's failure copy, and 250 MB is not what
   * this deployment processes.
   */
  if (requestedBytes > FOUNDATION_INTAKE_MAX_BYTES) {
    return NextResponse.json({
      code: "SOURCE_EXCEEDS_PROCESSING_CEILING",
      maxBytes: FOUNDATION_INTAKE_MAX_BYTES,
      maxPages: PROCESSING_CEILING.maxSourcePages,
      limit: PROCESSING_CEILING_SENTENCE,
    }, { status: 413, headers: NO_STORE });
  }
  if (auth.principal.accessSource === "trial" && requestedBytes > FOUNDATION_TRIAL_INTAKE_MAX_BYTES) {
    return NextResponse.json({ code: "TRIAL_FILE_TOO_LARGE", maxBytes: FOUNDATION_TRIAL_INTAKE_MAX_BYTES }, { status: 413, headers: NO_STORE });
  }

  if (auth.principal.accessSource === "trial" && /\.zip$/i.test(originalFilename)) {
    return NextResponse.json({ code: "TRIAL_ARCHIVE_NOT_INCLUDED" }, { status: 402, headers: NO_STORE });
  }

  const qualified = validateQualifiedDocumentInput({ originalFilename, declaredMimeType });
  if (!qualified.valid) {
    return NextResponse.json({ code: qualified.code }, { status: 400, headers: NO_STORE });
  }
  // A signed PUT URL admits bytes and reserves compute. Check before issuing either.
  const workspaceId = auth.principal.workspaceKey;
  if (!await canAdmitCustomerSource(workspaceId, "direct_upload")) {
    return NextResponse.json({ code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" }, { status: 403, headers: NO_STORE });
  }
  const signer = readR2SignerEnv();
  if (!signer) return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });

  // A capability must reference the immutable whole-set approval and its stable source key.
  const attemptKey = typeof body.attemptKey === "string" ? body.attemptKey : "";
  const scopeDigest = typeof body.scopeDigest === "string" ? body.scopeDigest : "";
  const pricingFingerprint = typeof body.pricingFingerprint === "string" ? body.pricingFingerprint : "";
  const fileKey = typeof body.fileKey === "string" ? body.fileKey : "";
  const contentSha256 = typeof body.contentSha256 === "string" ? body.contentSha256 : "";
  const sourceIdempotencyKey = request.headers.get("x-tavonel-source-idempotency-key");
  const expectedSourceIdempotencyKey = await approvedSourceIdempotencyKey(attemptKey, fileKey);
  if (!ATTEMPT_KEY_PATTERN.test(attemptKey) || !SHA256_DIGEST_PATTERN.test(scopeDigest)
    || !SHA256_DIGEST_PATTERN.test(pricingFingerprint) || !FILE_KEY_PATTERN.test(fileKey)
    || !SHA256_DIGEST_PATTERN.test(contentSha256) || sourceIdempotencyKey === null
    || sourceIdempotencyKey !== expectedSourceIdempotencyKey) {
    return NextResponse.json({ code: "INTAKE_APPROVAL_REQUIRED" }, { status: 428, headers: NO_STORE });
  }
  const approval = await readFoundationIntakeApproval({ workspaceKey: workspaceId, userId: auth.principal.userId, attemptKey });
  if (!approval.ok) return NextResponse.json({ code: approval.code }, { status: approval.status, headers: NO_STORE });
  if (approval.result.pricingFingerprint !== await intakePricingFingerprint()) {
    return NextResponse.json({ code: "INTAKE_PRICE_STALE" }, { status: 409, headers: NO_STORE });
  }
  const approvedFile = approval.result.files.find((file) => file.fileKey === fileKey);
  if (!approvedFile || approval.result.scopeDigest !== scopeDigest || approval.result.pricingFingerprint !== pricingFingerprint
    || approvedFile.contentSha256 !== contentSha256 || approvedFile.byteLength !== requestedBytes
    || approvedFile.mimeType !== qualified.normalizedMimeType) {
    return NextResponse.json({ code: "INTAKE_APPROVAL_SCOPE_MISMATCH" }, { status: 409, headers: NO_STORE });
  }
  const documentId = approvedFile.documentId;
  if (await deterministicSourceDocumentId(workspaceId, sourceIdempotencyKey) !== documentId) {
    return NextResponse.json({ code: "SOURCE_IDEMPOTENCY_KEY_INVALID" }, { status: 409, headers: NO_STORE });
  }
  const objectKey = `quarantine/${workspaceId}/${documentId}/source`;
  const admission = await reserveFoundationIntake({
    workspaceKey: workspaceId, documentId, userId: auth.principal.userId, objectKey,
    requestedBytes, declaredMimeType: qualified.normalizedMimeType,
  });
  if (!admission.ok) return NextResponse.json({ code: admission.code }, {
    status: admission.code.includes("LIMIT") || admission.code.includes("QUOTA") ? 429 : admission.code.includes("TRIAL") ? 402 : 503,
    headers: NO_STORE,
  });
  const compute = await reserveFoundationIntakeApprovedFile({
    workspaceKey: workspaceId, userId: auth.principal.userId, attemptKey, scopeDigest, pricingFingerprint, fileKey, documentId,
  });
  if (!compute.ok) return NextResponse.json({ code: compute.code }, { status: compute.status, headers: NO_STORE });
  const signed = presignFoundationQuarantinePut(signer, {
    key: objectKey, contentType: qualified.normalizedMimeType, contentLength: requestedBytes, expiresInSeconds: 300,
  });
  if (!signed.ok) return NextResponse.json({ code: signed.code }, { status: 503, headers: NO_STORE });
  return NextResponse.json({
    code: "QUALIFIED", documentId, objectKey, uploadUrl: signed.uploadUrl, expiresInSeconds: 300,
    contentLength: requestedBytes, originalFilename: qualified.originalFilename,
    declaredMimeType: qualified.normalizedMimeType, sanitization: "pending_cdr", sourceIdempotency: "stable",
    admissionExpiresAt: admission.result.expiresAt,
    computeReservation: {
      reservationId: compute.result.reservationId,
      reservedCredits: compute.result.approvedReservedCredits,
      maximumCredits: compute.result.approvedMaximumCredits,
      billingSource: compute.result.billingSource,
      expiresAt: compute.result.reservationExpiresAt,
      quote: {
        approvedMaxPages: compute.result.approvedMaxPages,
        estimatedUsd: compute.result.approvedReservedCredits / 100,
        maximumUsd: compute.result.approvedMaximumCredits / 100,
        pageBasis: compute.result.pageBasis,
      },
    },
  }, { headers: NO_STORE });


}
