import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { readBoundedJson } from "@/lib/enterprise-http";
import { canAdmitCustomerSource } from "@/lib/customer-data-admission";
import {
  claimFoundationIntakeTriageStage,
  finishFoundationIntakeTriageStage,
} from "@/lib/compute-reservation";
import { deriveFileKey } from "@/lib/intake-approval";
import { validateFoundationTriageSealClaim } from "@/lib/intake-seal-fencing";
import { verifySourceSignature } from "@/lib/magic-bytes";
import { INTAKE_TRIAGE_ROLLOUT_ENABLED, intakeTriageDisabledResponse } from "@/lib/intake-triage-rollout";
import {
  readFoundationTriageStagingObject,
  readR2SignerEnv,
  sealFoundationTriageSource,
} from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!INTAKE_TRIAGE_ROLLOUT_ENABLED) return intakeTriageDisabledResponse();
  if (!activationPolicy.customerIntake.enabled) {
    return NextResponse.json({ code: "INTAKE_DISABLED", reason: activationPolicy.customerIntake.reason }, { status: 503, headers: NO_STORE });
  }
  const auth = await authorizeFoundationRequest(request, "documents:intake", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  if (!await canAdmitCustomerSource(auth.principal.workspaceKey, "direct_upload")) {
    return NextResponse.json({ code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" }, { status: 403, headers: NO_STORE });
  }
  const parsed = await readBoundedJson(request, 1_024);
  if (!parsed.ok) return NextResponse.json({ code: "TRIAGE_COMPLETE_BODY_INVALID" }, { status: parsed.status, headers: NO_STORE });
  const body = parsed.value as { stageId?: unknown; preflightApprovalId?: unknown } | null;
  const stageId = body?.stageId;
  const preflightApprovalId = body?.preflightApprovalId;
  if (typeof stageId !== "string" || !UUID.test(stageId)
    || typeof preflightApprovalId !== "string" || !UUID.test(preflightApprovalId)) {
    return NextResponse.json({ code: "TRIAGE_COMPLETE_BODY_INVALID" }, { status: 400, headers: NO_STORE });
  }
  const signer = readR2SignerEnv();
  if (!signer) return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });

  const sealToken = randomUUID();
  const claim = await claimFoundationIntakeTriageStage({
    workspaceKey: auth.principal.workspaceKey, actorUserId: auth.principal.userId, stageId, sealToken, preflightApprovalId,
  });
  if (!claim.ok) return NextResponse.json({ code: claim.code }, { status: claim.status, headers: NO_STORE });
  const rawStage = claim.json as Record<string, unknown>;
  if (rawStage.workspaceKey !== auth.principal.workspaceKey || rawStage.actorUserId !== auth.principal.userId
    || rawStage.stageId !== stageId) {
    return NextResponse.json({ code: "INTAKE_TRIAGE_STAGE_RECEIPT_INVALID" }, { status: 503, headers: NO_STORE });
  }
  if (rawStage.state === "sealed") {
    return NextResponse.json({ code: "TRIAGE_FILE_SEALED", stage: rawStage }, { headers: NO_STORE });
  }
  const stage = validateFoundationTriageSealClaim({
    claim: rawStage, workspaceKey: auth.principal.workspaceKey,
    actorUserId: auth.principal.userId, stageId, preflightApprovalId, sealToken,
  });
  if (!stage) return NextResponse.json({ code: "INTAKE_TRIAGE_SEAL_RETRY_REQUIRED" }, { status: 409, headers: NO_STORE });
  const documentId = typeof stage.documentId === "string" ? stage.documentId : "";
  const relativePath = typeof stage.relativePath === "string" ? stage.relativePath : "";
  const mimeType = typeof stage.declaredMimeType === "string" ? stage.declaredMimeType : "";
  const expectedBytes = typeof stage.requestedBytes === "number" ? stage.requestedBytes : Number.NaN;
  if (!UUID.test(documentId) || documentId !== sealToken || !relativePath || !mimeType
    || !Number.isSafeInteger(expectedBytes)) {
    return NextResponse.json({ code: "INTAKE_TRIAGE_STAGE_RECEIPT_INVALID" }, { status: 503, headers: NO_STORE });
  }

  const observed = await readFoundationTriageStagingObject(signer, {
    workspaceKey: auth.principal.workspaceKey, stageId, expectedBytes, mimeType,
  });
  if (!observed.ok) return NextResponse.json({ code: observed.code }, { status: 409, headers: NO_STORE });
  const signature = verifySourceSignature(mimeType, observed.bytes.subarray(0, 512)).ok ? "valid" : "mismatch";
  const sealed = await sealFoundationTriageSource(signer, {
    workspaceKey: auth.principal.workspaceKey, documentId, bytes: observed.bytes,
    sha256: observed.sha256, mimeType,
  });
  if (!sealed.ok) return NextResponse.json({ code: sealed.code }, { status: 409, headers: NO_STORE });
  const fileKey = await deriveFileKey({
    relativePath, contentSha256: sealed.sha256, byteLength: sealed.byteLength, mimeType,
  });
  const completed = await finishFoundationIntakeTriageStage({
    workspaceKey: auth.principal.workspaceKey, actorUserId: auth.principal.userId,
    stageId, sealToken, fenceGeneration: stage.fenceGeneration,
    fileKey, contentSha256: sealed.sha256, objectEtag: sealed.etag, signature,
  });
  if (!completed.ok) return NextResponse.json({ code: completed.code }, { status: completed.status, headers: NO_STORE });
  const result = completed.json as Record<string, unknown>;
  if (result.stageId !== stageId || result.state !== "sealed" || result.fileKey !== fileKey
    || result.contentSha256 !== sealed.sha256 || result.sealedSourceKey !== sealed.key) {
    return NextResponse.json({ code: "INTAKE_TRIAGE_STAGE_RECEIPT_INVALID" }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({
    code: "TRIAGE_FILE_SEALED", stage: result,
    observation: { signature, encryption: "unknown", corruption: "unknown", archiveExpansion: "unknown" },
  }, { headers: NO_STORE });
}
