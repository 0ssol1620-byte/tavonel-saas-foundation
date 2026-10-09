import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { readBoundedJson } from "@/lib/enterprise-http";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { canAdmitCustomerSource } from "@/lib/customer-data-admission";
import {
  MAX_APPROVAL_FILES,
  MAX_APPROVAL_METADATA_BYTES,
  SHA256_DIGEST_PATTERN,
  intakeManifestDigest,
  readManifestEntry,
  type IntakeManifestEntry,
} from "@/lib/intake-approval";
import { readReadyUploadTriage } from "@/lib/intake-triage-server";
import { INTAKE_TRIAGE_ROLLOUT_ENABLED } from "@/lib/intake-triage-rollout";
import { validateQualifiedDocumentInput } from "@/lib/qualified-input";
import {
  FOUNDATION_INTAKE_MAX_BYTES,
  FOUNDATION_TRIAL_INTAKE_MAX_BYTES,
  PROCESSING_CEILING,
  PROCESSING_CEILING_SENTENCE,
} from "@/lib/r2-presign";
import { intakePricingFingerprint, quoteIntakeManifest } from "@/lib/usage-pricing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
// The page maximum an uncounted member is approved at. The approval POST refuses a deployment
// whose ceiling drifted from it, so a quote must not show a number that approval would refuse.
const UNKNOWN_MEMBER_PAGES = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function refuse(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { code, ...extra },
    { status, headers: status === 503 ? { ...NO_STORE, "Retry-After": "5" } : NO_STORE },
  );
}

/*
  Quote a whole selected set, before anything is approved.

  Advisory only: this creates no hold. No approval row, no admission reservation, no compute
  ledger entry -- nothing here writes. It runs the same manifest checks as the approval POST so
  the number shown is the number approval would compute, but the approval POST recomputes the
  quote and the pricing fingerprint itself before it commits, and that recomputation is the only
  one that binds.
*/
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json") || !Number.isFinite(contentLength)
    || contentLength > MAX_APPROVAL_METADATA_BYTES) {
    return refuse("METADATA_ONLY_ENDPOINT", 415);
  }
  if (!activationPolicy.customerIntake.enabled) {
    return NextResponse.json(
      { code: "INTAKE_DISABLED", reason: activationPolicy.customerIntake.reason },
      { status: 503, headers: { ...NO_STORE, "Retry-After": "60" } },
    );
  }

  const auth = await authorizeFoundationRequest(request, "documents:intake", "observer");
  if (!auth.ok) return refuse(auth.code, auth.status);

  const parsed = await readBoundedJson(request, MAX_APPROVAL_METADATA_BYTES);
  if (!parsed.ok) {
    return parsed.code === "REQUEST_TOO_LARGE"
      ? refuse("METADATA_ONLY_ENDPOINT", 413, { metadataLimitBytes: MAX_APPROVAL_METADATA_BYTES })
      : refuse("INTAKE_APPROVAL_INVALID", 400);
  }
  const body = (parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? parsed.value : {}) as {
    triageReceiptId?: unknown;
    clientManifestDigest?: unknown;
    files?: unknown;
  };
  let triage: Awaited<ReturnType<typeof readReadyUploadTriage>> | null = null;
  let entries: IntakeManifestEntry[];
  let clientManifestDigest: string;
  if (INTAKE_TRIAGE_ROLLOUT_ENABLED) {
    const triageReceiptId = typeof body.triageReceiptId === "string" ? body.triageReceiptId : "";
    if (!UUID.test(triageReceiptId)) return refuse("INTAKE_TRIAGE_REQUIRED", 409);
    triage = await readReadyUploadTriage({
      workspaceKey: auth.principal.workspaceKey, userId: auth.principal.userId, receiptId: triageReceiptId,
    });
    if (!triage.ok) return refuse(triage.code, triage.status);
    entries = triage.result.entries;
    clientManifestDigest = triage.result.clientManifestDigest;
  } else {
    clientManifestDigest = typeof body.clientManifestDigest === "string" ? body.clientManifestDigest : "";
    if (!SHA256_DIGEST_PATTERN.test(clientManifestDigest) || !Array.isArray(body.files)
      || body.files.length < 1 || body.files.length > MAX_APPROVAL_FILES) return refuse("INTAKE_APPROVAL_INVALID", 400);
    entries = [];
    for (const [index, value] of body.files.entries()) {
      const entry = readManifestEntry(value);
      if (!entry) return refuse("INTAKE_APPROVAL_INVALID", 400, { index });
      entries.push(entry);
    }
    if (new Set(entries.map((entry) => entry.fileKey)).size !== entries.length
      || await intakeManifestDigest(entries) !== clientManifestDigest) return refuse("INTAKE_APPROVAL_MANIFEST_MISMATCH", 400);
  }
  if (entries.length < 1 || entries.length > MAX_APPROVAL_FILES) return refuse("INTAKE_APPROVAL_INVALID", 400);

  const trial = auth.principal.accessSource === "trial";
  for (const [index, entry] of entries.entries()) {
    const qualified = validateQualifiedDocumentInput({ originalFilename: entry.originalFilename, declaredMimeType: entry.mimeType });
    if (!qualified.valid) return refuse(qualified.code, 400, { index });
    // Quoted under the type the capability would be signed for, as approval does.
    if (qualified.normalizedMimeType !== entry.mimeType) return refuse("INTAKE_APPROVAL_MIME_NOT_NORMALIZED", 400, { index });
    if (entry.byteLength > FOUNDATION_INTAKE_MAX_BYTES) {
      return refuse("SOURCE_EXCEEDS_PROCESSING_CEILING", 413, {
        index,
        maxBytes: FOUNDATION_INTAKE_MAX_BYTES,
        maxPages: PROCESSING_CEILING.maxSourcePages,
        limit: PROCESSING_CEILING_SENTENCE,
      });
    }
    if (trial && entry.byteLength > FOUNDATION_TRIAL_INTAKE_MAX_BYTES) {
      return refuse("TRIAL_FILE_TOO_LARGE", 413, { index, maxBytes: FOUNDATION_TRIAL_INTAKE_MAX_BYTES });
    }
    if (trial && /\.zip$/i.test(entry.originalFilename)) return refuse("TRIAL_ARCHIVE_NOT_INCLUDED", 402, { index });
  }

  if (!await canAdmitCustomerSource(auth.principal.workspaceKey, "direct_upload")) {
    return refuse("CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", 403);
  }

  const pricingFingerprint = await intakePricingFingerprint();
  if (triage && pricingFingerprint !== triage.result.receipt.pricingFingerprint) {
    return refuse("INTAKE_PRICE_STALE", 409, { pricingFingerprint });
  }
  const quoted = quoteIntakeManifest(entries.map((entry) => ({
    bytes: entry.byteLength,
    mimeType: entry.mimeType,
    claimedPages: entry.claimedPages,
    claimedBasis: entry.claimedBasis,
  })));
  if (!quoted.ok) {
    return quoted.code === "SOURCE_EXCEEDS_PROCESSING_CEILING"
      ? refuse(quoted.code, 413, {
        index: quoted.index,
        maxBytes: FOUNDATION_INTAKE_MAX_BYTES,
        maxPages: PROCESSING_CEILING.maxSourcePages,
        limit: PROCESSING_CEILING_SENTENCE,
      })
      : refuse(quoted.code, 400, { index: quoted.index });
  }
  const quote = quoted.quote;
  if (quote.files.some((file) => file.pageBasis === "unknown" && file.approvedMaxPages !== UNKNOWN_MEMBER_PAGES)) {
    return refuse("INTAKE_APPROVAL_UNKNOWN_CEILING_REQUIRED", 503);
  }

  return NextResponse.json({
    code: "INTAKE_QUOTE",
    ...(triage ? {
      triageReceiptId: triage.result.receipt.receiptId,
      triageVersion: triage.result.receipt.triageVersion,
      triageInventoryDigest: triage.result.receipt.inventoryDigest,
      configurationRevision: triage.result.receipt.configurationRevision,
      estimate: triage.result.receipt.estimate,
    } : {}),
    clientManifestDigest,
    pricingFingerprint,
    metadataLimitBytes: MAX_APPROVAL_METADATA_BYTES,
    quote: {
      maximumPages: quote.maximumPages,
      reservedCredits: quote.reservedCredits,
      maximumCredits: quote.maximumCredits,
      estimatedUsd: quote.estimatedUsd,
      maximumUsd: quote.maximumUsd,
    },
    files: entries.map((entry, index) => ({
      fileKey: entry.fileKey,
      pageBasis: quote.files[index]!.pageBasis,
      approvedMaxPages: quote.files[index]!.approvedMaxPages,
      reservedCredits: quote.files[index]!.reservedCredits,
      maximumCredits: quote.files[index]!.maximumCredits,
    })),
  }, { headers: NO_STORE });
}
