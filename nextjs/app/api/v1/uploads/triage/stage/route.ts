import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { readBoundedJson } from "@/lib/enterprise-http";
import { canAdmitCustomerSource } from "@/lib/customer-data-admission";
import { createFoundationIntakeTriageStage } from "@/lib/compute-reservation";
import { validateQualifiedDocumentInput } from "@/lib/qualified-input";
import { FOUNDATION_TRIAL_INTAKE_MAX_BYTES } from "@/lib/r2-presign";
import { presignFoundationTriageStagingPut } from "@/lib/r2-presign";
import { readR2SignerEnv, FOUNDATION_TRIAGE_MAX_SOURCE_BYTES } from "@/lib/r2-synthetic-canary";
import { INTAKE_TRIAGE_ROLLOUT_ENABLED, intakeTriageDisabledResponse } from "@/lib/intake-triage-rollout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FILES = 128;
const MAX_JSON_BYTES = 512 * 1024;
const UPLOAD_URL_SECONDS = 120;

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024
    || value.startsWith("/") || value.startsWith("\\") || /[\x00-\x1f\x7f]/.test(value)) return false;
  const parts = value.replaceAll("\\", "/").split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

export async function POST(request: Request) {
  if (!INTAKE_TRIAGE_ROLLOUT_ENABLED) return intakeTriageDisabledResponse();
  if (!activationPolicy.customerIntake.enabled) {
    return NextResponse.json({ code: "INTAKE_DISABLED", reason: activationPolicy.customerIntake.reason }, { status: 503, headers: NO_STORE });
  }
  const auth = await authorizeFoundationRequest(request, "documents:intake", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const parsed = await readBoundedJson(request, MAX_JSON_BYTES);
  if (!parsed.ok) return NextResponse.json({ code: "TRIAGE_STAGE_BODY_INVALID" }, { status: parsed.status, headers: NO_STORE });
  const body = parsed.value as { batchId?: unknown; files?: unknown };
  if (typeof body.batchId !== "string" || !UUID.test(body.batchId) || !Array.isArray(body.files)
    || body.files.length < 1 || body.files.length > MAX_FILES) {
    return NextResponse.json({ code: "TRIAGE_STAGE_BODY_INVALID" }, { status: 400, headers: NO_STORE });
  }
  if (!await canAdmitCustomerSource(auth.principal.workspaceKey, "direct_upload")) {
    return NextResponse.json({ code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" }, { status: 403, headers: NO_STORE });
  }
  const signer = readR2SignerEnv();
  if (!signer) return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });

  const staged: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (let index = 0; index < body.files.length; index += 1) {
    const item = body.files[index] as Record<string, unknown> | null;
    const relativePath = item?.relativePath;
    const idempotencyKey = item?.idempotencyKey;
    const declaredMimeType = typeof item?.declaredMimeType === "string" ? item.declaredMimeType : "";
    const requestedBytes = typeof item?.requestedBytes === "number" ? item.requestedBytes : Number.NaN;
    if (!item || !safeRelativePath(relativePath) || typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)
      || seen.has(idempotencyKey) || !Number.isSafeInteger(requestedBytes) || requestedBytes < 1
      || requestedBytes > FOUNDATION_TRIAGE_MAX_SOURCE_BYTES) {
      errors.push({ index, code: "TRIAGE_STAGE_FILE_INVALID" });
      continue;
    }
    seen.add(idempotencyKey);
    const originalFilename = relativePath.replaceAll("\\", "/").split("/").at(-1) ?? "";
    const qualified = validateQualifiedDocumentInput({ originalFilename, declaredMimeType });
    if (!qualified.valid) {
      errors.push({ index, relativePath, code: qualified.code, disposition: "exclude_before_upload" });
      continue;
    }
    if (auth.principal.accessSource === "trial" && requestedBytes > FOUNDATION_TRIAL_INTAKE_MAX_BYTES) {
      errors.push({ index, relativePath, code: "TRIAL_FILE_TOO_LARGE", disposition: "exclude_before_upload" });
      continue;
    }
    const created = await createFoundationIntakeTriageStage({
      workspaceKey: auth.principal.workspaceKey,
      actorUserId: auth.principal.userId,
      batchId: body.batchId,
      stageId: randomUUID(),
      documentId: randomUUID(),
      idempotencyKey,
      relativePath: relativePath.replaceAll("\\", "/"),
      originalFilename,
      declaredMimeType: qualified.normalizedMimeType,
      requestedBytes,
    });
    if (!created.ok) {
      errors.push({ index, code: created.code });
      continue;
    }
    const row = created.json as Record<string, unknown>;
    if (row.batchId !== body.batchId || row.workspaceKey !== auth.principal.workspaceKey
      || row.actorUserId !== auth.principal.userId || typeof row.stageId !== "string" || !UUID.test(row.stageId)
      || typeof row.createdAt !== "string" || typeof row.uploadExpiresAt !== "string"
      || Date.parse(row.uploadExpiresAt) <= Date.now() || row.stagingKey !== `quarantine/${auth.principal.workspaceKey}/triage-staging/${row.stageId}/upload`) {
      errors.push({ index, code: "INTAKE_TRIAGE_STAGE_RECEIPT_INVALID" });
      continue;
    }
    const upload = presignFoundationTriageStagingPut(signer, {
      workspaceKey: auth.principal.workspaceKey, stageId: row.stageId,
      contentType: qualified.normalizedMimeType, contentLength: requestedBytes,
      expiresInSeconds: UPLOAD_URL_SECONDS, now: new Date(row.createdAt),
    });
    if (!upload.ok) {
      errors.push({ index, code: upload.code });
      continue;
    }
    staged.push({
      index, stageId: row.stageId, relativePath: row.relativePath,
      originalFilename: row.originalFilename, declaredMimeType: row.declaredMimeType,
      requestedBytes, stagingKey: row.stagingKey, uploadUrl: upload.uploadUrl,
      expiresAt: row.uploadExpiresAt, triageExpiresAt: row.expiresAt,
    });
  }
  return NextResponse.json({ code: errors.length ? "TRIAGE_STAGE_PARTIAL" : "TRIAGE_STAGE_READY", batchId: body.batchId, staged, errors }, {
    status: staged.length ? 200 : 400, headers: NO_STORE,
  });
}
