import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { readBoundedJson } from "@/lib/enterprise-http";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import {
  createFoundationIntakeApproval,
  readFoundationIntakeApproval,
  type ApprovedFileQuote,
} from "@/lib/compute-reservation";
import { canAdmitCustomerSource } from "@/lib/customer-data-admission";
import {
  ATTEMPT_KEY_PATTERN,
  MAX_APPROVAL_FILES,
  MAX_APPROVAL_METADATA_BYTES,
  SHA256_DIGEST_PATTERN,
  intakeManifestDigest,
  readManifestEntry,
  type IntakeManifestEntry,
} from "@/lib/intake-approval";
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
// No file bytes are accepted by this endpoint. Quote and approval share this metadata bound.
const MAX_BODY_BYTES = MAX_APPROVAL_METADATA_BYTES;
// The page maximum an uncounted member is approved at. `readApprovalFilePayload` holds the
// database to the same number; a deployment whose ceiling drifted from it must not approve.
const UNKNOWN_MEMBER_PAGES = 80;

function refuse(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { code, ...extra },
    { status, headers: status === 503 ? { ...NO_STORE, "Retry-After": "5" } : NO_STORE },
  );
}

/*
  Approve a whole selected set, before any byte moves.

  The browser sends its manifest -- digests, lengths, types and page *claims* -- and the maximum
  it showed the customer. Every number that is approved is computed here, from the claims, by
  `quoteIntakeManifest`; a claim is an input to the quote and never a verified page count. The
  approval is refused rather than repaired when the manifest is malformed, when the customer was
  shown a different maximum, or when the price it was shown under is no longer the price.
*/
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json") || !Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
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

  const parsed = await readBoundedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok) return refuse("INTAKE_APPROVAL_INVALID", 400);
  const body = (parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? parsed.value : {}) as {
    attemptKey?: unknown;
    clientManifestDigest?: unknown;
    pricingFingerprint?: unknown;
    aggregateMaximumCredits?: unknown;
    files?: unknown;
  };
  const attemptKey = typeof body.attemptKey === "string" ? body.attemptKey : "";
  const clientManifestDigest = typeof body.clientManifestDigest === "string" ? body.clientManifestDigest : "";
  const pricingFingerprint = typeof body.pricingFingerprint === "string" ? body.pricingFingerprint : "";
  const shownMaximumCredits = typeof body.aggregateMaximumCredits === "number" ? body.aggregateMaximumCredits : Number.NaN;
  if (!ATTEMPT_KEY_PATTERN.test(attemptKey) || !SHA256_DIGEST_PATTERN.test(clientManifestDigest)
    || !SHA256_DIGEST_PATTERN.test(pricingFingerprint) || !Number.isSafeInteger(shownMaximumCredits) || shownMaximumCredits < 1
    || !Array.isArray(body.files) || body.files.length < 1 || body.files.length > MAX_APPROVAL_FILES) {
    return refuse("INTAKE_APPROVAL_INVALID", 400);
  }

  // Every member well formed, or no approval. `readManifestEntry` refuses a page count without a
  // basis and a basis without a count, so a half-described member never reaches the quote.
  const entries: IntakeManifestEntry[] = [];
  for (const [index, raw] of body.files.entries()) {
    const entry = readManifestEntry(raw);
    if (!entry) return refuse("INTAKE_APPROVAL_INVALID", 400, { index });
    entries.push(entry);
  }
  if (new Set(entries.map((entry) => entry.fileKey)).size !== entries.length) {
    return refuse("INTAKE_APPROVAL_DUPLICATE_FILE", 400);
  }

  const trial = auth.principal.accessSource === "trial";
  for (const [index, entry] of entries.entries()) {
    const qualified = validateQualifiedDocumentInput({ originalFilename: entry.originalFilename, declaredMimeType: entry.mimeType });
    if (!qualified.valid) return refuse(qualified.code, 400, { index });
    // The member is approved under the type the capability will be signed for, and its file key
    // was derived from that type. A type the server would normalize differently is another member.
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

  // The digest the browser shows alongside the approval must describe exactly what it sent.
  if (await intakeManifestDigest(entries) !== clientManifestDigest) return refuse("INTAKE_APPROVAL_MANIFEST_MISMATCH", 400);

  const currentFingerprint = await intakePricingFingerprint();
  if (pricingFingerprint !== currentFingerprint) {
    return refuse("INTAKE_PRICE_STALE", 409, { pricingFingerprint: currentFingerprint });
  }

  if (!await canAdmitCustomerSource(auth.principal.workspaceKey, "direct_upload")) {
    return refuse("CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", 403);
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
  const summary = {
    maximumPages: quote.maximumPages,
    reservedCredits: quote.reservedCredits,
    maximumCredits: quote.maximumCredits,
    estimatedUsd: quote.estimatedUsd,
    maximumUsd: quote.maximumUsd,
  };
  // The customer approves a number. If it is not the number this server would hold, they approved
  // something else -- show them this one and let them approve again.
  if (shownMaximumCredits !== quote.maximumCredits) {
    return refuse("INTAKE_APPROVAL_AGGREGATE_MISMATCH", 409, { quote: summary });
  }

  const files: ApprovedFileQuote[] = entries.map((entry, index) => ({
    fileKey: entry.fileKey,
    contentSha256: entry.contentSha256,
    byteLength: entry.byteLength,
    mimeType: entry.mimeType,
    pageBasis: quote.files[index]!.pageBasis,
    approvedMaxPages: quote.files[index]!.approvedMaxPages,
    reservedCredits: quote.files[index]!.reservedCredits,
    maximumCredits: quote.files[index]!.maximumCredits,
  }));
  const created = await createFoundationIntakeApproval({
    workspaceKey: auth.principal.workspaceKey,
    userId: auth.principal.userId,
    attemptKey,
    clientManifestDigest,
    pricingFingerprint: currentFingerprint,
    aggregateMaximumCredits: quote.maximumCredits,
    files,
  });
  // A 503 here may have committed. The client reconciles with GET, never with a second POST guess.
  if (!created.ok) return refuse(created.code, created.status);
  return NextResponse.json({ code: "INTAKE_APPROVED", approval: created.result, quote: summary }, { headers: NO_STORE });
}

/** The authoritative state of one attempt, for a reload or a lost reply. Read-only. */
export async function GET(request: Request) {
  const auth = await authorizeFoundationRequest(request, "documents:intake", "observer");
  if (!auth.ok) return refuse(auth.code, auth.status);
  const attemptKey = new URL(request.url).searchParams.get("attemptKey") ?? "";
  if (!ATTEMPT_KEY_PATTERN.test(attemptKey)) return refuse("INTAKE_APPROVAL_INVALID", 400);
  const read = await readFoundationIntakeApproval({
    workspaceKey: auth.principal.workspaceKey,
    userId: auth.principal.userId,
    attemptKey,
  });
  if (!read.ok) return refuse(read.code, read.status);
  return NextResponse.json({ code: "INTAKE_APPROVAL", approval: read.result }, { headers: NO_STORE });
}
