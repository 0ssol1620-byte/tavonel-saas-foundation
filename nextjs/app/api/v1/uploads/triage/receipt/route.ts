import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { readBoundedJson } from "@/lib/enterprise-http";
import { canAdmitCustomerSource } from "@/lib/customer-data-admission";
import {
  createFoundationIntakeTriageReceipt,
  readFoundationIntakeTriageStages,
} from "@/lib/compute-reservation";
import { intakeManifestDigest, type IntakeManifestEntry } from "@/lib/intake-approval";
import { buildIntakeTriage, intakeTriageDigest, type TriageChoice, type TriageObservation } from "@/lib/intake-triage";
import { MAX_APPROVAL_FILES } from "@/lib/intake-approval";
import { quoteIntakeManifest, intakePricingFingerprint } from "@/lib/usage-pricing";
import { INTAKE_TRIAGE_ROLLOUT_ENABLED, intakeTriageDisabledResponse } from "@/lib/intake-triage-rollout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRIAGE_CONFIGURATION_REVISION = "tavonel-intake-triage-config-v2";

function rowsFrom(value: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row));
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rows = (value as Record<string, unknown>).stages;
  return Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row))
    : null;
}

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
  const parsed = await readBoundedJson(request, 32 * 1024);
  if (!parsed.ok) return NextResponse.json({ code: "TRIAGE_RECEIPT_BODY_INVALID" }, { status: parsed.status, headers: NO_STORE });
  const body = parsed.value as { batchId?: unknown; preflightApprovalId?: unknown; choices?: unknown };
  if (typeof body.batchId !== "string" || !UUID.test(body.batchId)
    || typeof body.preflightApprovalId !== "string" || !UUID.test(body.preflightApprovalId)
    || !body.choices || typeof body.choices !== "object" || Array.isArray(body.choices)) {
    return NextResponse.json({ code: "TRIAGE_RECEIPT_BODY_INVALID" }, { status: 400, headers: NO_STORE });
  }
  const loaded = await readFoundationIntakeTriageStages({
    workspaceKey: auth.principal.workspaceKey, actorUserId: auth.principal.userId, batchId: body.batchId,
  });
  if (!loaded.ok) return NextResponse.json({ code: loaded.code }, { status: loaded.status, headers: NO_STORE });
  const rows = rowsFrom(loaded.json);
  if (!rows || rows.length < 1 || rows.length > MAX_APPROVAL_FILES
    || rows.some((row) => row.workspaceKey !== auth.principal.workspaceKey || row.actorUserId !== auth.principal.userId
      || row.batchId !== body.batchId || Date.parse(String(row.expiresAt)) <= Date.now())) {
    return NextResponse.json({ code: "INTAKE_TRIAGE_BATCH_INCOMPLETE" }, { status: 409, headers: NO_STORE });
  }
  const preflightRows = rows.filter((row) => row.preflightApprovalId === body.preflightApprovalId);
  if (!preflightRows.length || preflightRows.some((row) => row.state !== "sealed")) {
    return NextResponse.json({ code: "INTAKE_TRIAGE_PREFLIGHT_INCOMPLETE" }, { status: 409, headers: NO_STORE });
  }

  const choices = body.choices as Record<string, unknown>;
  const observations: TriageObservation[] = [];
  const entriesByKey = new Map<string, IntakeManifestEntry>();
  const fileBindings: Array<Record<string, unknown>> = [];
  for (const row of preflightRows) {
    const relativePath = typeof row.relativePath === "string" ? row.relativePath : "";
    const originalFilename = typeof row.originalFilename === "string" ? row.originalFilename : "";
    const contentSha256 = typeof row.contentSha256 === "string" ? row.contentSha256 : "";
    const byteLength = typeof row.requestedBytes === "number" ? row.requestedBytes : Number.NaN;
    const mimeType = typeof row.declaredMimeType === "string" ? row.declaredMimeType : "";
    const fileKey = typeof row.fileKey === "string" ? row.fileKey : "";
    const documentId = typeof row.documentId === "string" ? row.documentId : "";
    const stageId = typeof row.stageId === "string" ? row.stageId : "";
    const objectKey = typeof row.sealedSourceKey === "string" ? row.sealedSourceKey : "";
    const objectEtag = typeof row.objectEtag === "string" ? row.objectEtag : null;
    const sealedAt = typeof row.sealedAt === "string" ? row.sealedAt : "";
    const uploadExpiresAt = typeof row.uploadExpiresAt === "string" ? row.uploadExpiresAt : "";
    if (!relativePath || !originalFilename || !/^sha256:[a-f0-9]{64}$/.test(contentSha256)
      || !Number.isSafeInteger(byteLength) || byteLength < 1 || !mimeType || !fileKey
      || !UUID.test(documentId) || !UUID.test(stageId)
      || objectKey !== `quarantine/${auth.principal.workspaceKey}/${documentId}/source`
      || !Number.isFinite(Date.parse(sealedAt)) || !Number.isFinite(Date.parse(uploadExpiresAt))) {
      return NextResponse.json({ code: "INTAKE_TRIAGE_STAGE_RECEIPT_INVALID" }, { status: 503, headers: NO_STORE });
    }
    const signature = row.signature === "valid" || row.signature === "mismatch" ? row.signature : "not_checked";
    const choice = choices[fileKey];
    observations.push({
      fileKey, relativePath, revision: null, byteLength, mimeType, contentSha256,
      digestEvidence: "server_verified", aclObservationSha256: null,
      signature, encryption: "unknown", corruption: "unknown", archiveExpansion: "unknown",
    });
    entriesByKey.set(fileKey, {
      fileKey, originalFilename, contentSha256, byteLength, mimeType,
      claimedPages: null, claimedBasis: null,
    });
    if (choice === "include") fileBindings.push({
      fileKey, stageId, documentId, objectKey, stagingKey: row.stagingKey, objectVersion: objectEtag,
      preflightApprovalId: row.preflightApprovalId,
      sealed: true, stagingWriteExpiresAt: uploadExpiresAt, sealMode: row.sealMode, sealedAt,
    });
  }
  if (Object.keys(choices).some((key) => !observations.some((row) => row.fileKey === key))
    || observations.some((row) => choices[row.fileKey] !== "include" && choices[row.fileKey] !== "exclude")) {
    return NextResponse.json({
      code: "TRIAGE_CHOICES_REQUIRED",
      review: observations.map((row) => ({ fileKey: row.fileKey, relativePath: row.relativePath, choice: choices[row.fileKey] ?? null })),
    }, { status: 409, headers: NO_STORE });
  }
  const requestedEntries = observations.filter((row) => choices[row.fileKey] === "include")
    .map((row) => entriesByKey.get(row.fileKey)!);
  if (requestedEntries.length < 1 || requestedEntries.length > MAX_APPROVAL_FILES) {
    return NextResponse.json({ code: "TRIAGE_NO_FILES_SELECTED" }, { status: 409, headers: NO_STORE });
  }
  const pricingFingerprint = await intakePricingFingerprint();
  const preliminaryPricing = quoteIntakeManifest(requestedEntries.map((entry) => ({
    bytes: entry.byteLength, mimeType: entry.mimeType, claimedPages: null, claimedBasis: null,
  })));
  if (!preliminaryPricing.ok) return NextResponse.json({ code: preliminaryPricing.code }, { status: 409, headers: NO_STORE });
  const estimate = {
    currency: "USD" as const,
    initial: { minimum: preliminaryPricing.quote.estimatedUsd, maximum: preliminaryPricing.quote.maximumUsd },
    incremental: { minimum: 0, maximum: 0 },
    customerChargeCoverage: {
      policy: "published_page_admission_once" as const,
      scope: "entire_affected_source_version_set" as const,
      pricingFingerprint,
      sourceVersions: requestedEntries.map((entry) => ({
        fileKey: entry.fileKey,
        revision: null,
        contentSha256: entry.contentSha256,
        mode: "new_read" as const,
      })),
    },
    operatorCost: { status: "not_priced" as const, unavailableProviders: ["cdr_infrastructure", "gpu_compute"] },
    basis: `published-customer-page-price:pricing-fingerprint:${pricingFingerprint}`,
    assumptions: [
      "Initial amount is the existing customer page charge for the complete selected source/version set.",
      "Unknown page counts use the existing full page ceiling.",
      "The published policy permits zero additional page charges only for unchanged source versions verified as already read with trusted proof of prior metering.",
      "New reads are covered by the initial amount; new versions and other rereads are not asserted to be free.",
      "Operator infrastructure cost is separate from the customer page charge and is not priced here.",
      "Triage performs no OCR, LLM, or compile calls.",
    ],
  };
  const inventoryRevision = await intakeManifestDigest(requestedEntries);
  const draft = buildIntakeTriage({
    scope: {
      workspaceKey: auth.principal.workspaceKey, sourceKind: "direct_upload",
      sourceId: body.batchId, inventoryRevision, aclObservationSha256: null,
    },
    configurationRevision: TRIAGE_CONFIGURATION_REVISION,
    pricingFingerprint,
    supportedMimeTypes: [...new Set(observations.map((row) => row.mimeType!).filter(Boolean))],
    observations,
    choices: choices as Record<string, TriageChoice>,
    estimate,
  });
  if (!draft) return NextResponse.json({ code: "INTAKE_TRIAGE_STAGE_RECEIPT_INVALID" }, { status: 400, headers: NO_STORE });
  // Preserve the charge for every source the customer chose to include, even if qualification
  // later blocks some of them. Never shrink a quote to a processable subset.
  const pricing = preliminaryPricing;
  const inventoryDigest = await intakeTriageDigest(draft);
  const inventory = { ...draft, inventoryDigest };
  const selectedBindings = fileBindings;
  const created = await createFoundationIntakeTriageReceipt({
    workspaceKey: auth.principal.workspaceKey,
    actorUserId: auth.principal.userId,
    sourceKind: "direct_upload",
    sourceId: body.batchId,
    inventoryRevision,
    triageVersion: inventory.version,
    inventoryDigest,
    configurationRevision: inventory.configurationRevision,
    pricingFingerprint,
    inventory,
    estimate,
    fileBindings: selectedBindings,
    approvalReady: inventory.approvalReady,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (!created.ok) return NextResponse.json({ code: created.code }, { status: created.status, headers: NO_STORE });
  return NextResponse.json({
    code: inventory.approvalReady ? "TRIAGE_RECEIPT_READY" : "TRIAGE_REVIEW_REQUIRED", receipt: created.result,
    review: inventory.files, approvalBlockers: inventory.approvalBlockers,
    estimate, quote: pricing.quote,
    approvalStage: "preflight_complete_full_processing_unapproved",
  }, { headers: NO_STORE });
}
