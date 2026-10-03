import { NextResponse } from "next/server";
import { API_VERSION } from "@/lib/api-version";
import { API_ERROR_CODES, apiErrorCode } from "@/lib/api-error-codes";
import { DEVELOPER_SCOPES } from "../../../lib/developer-contracts";
import { resolveOpenApiOrigin } from "../../../lib/openapi-origin";
import { qualifiedDocumentInputs } from "../../../lib/qualified-input";
import { MAX_APPROVAL_FILES, MAX_APPROVAL_METADATA_BYTES } from "@/lib/intake-approval";

// The published server URL must be the origin the caller actually reached, and this route
// used to be force-static: Next.js evaluated the handler once at build time, so
// `new URL(request.url).origin` froze to whatever the builder saw -- http://localhost:3000 --
// and every production consumer of /api/openapi was handed a spec pointing at the developer's
// own machine. An SDK generated from it would target localhost.
//
// force-dynamic makes the origin the request's own, so the spec is correct behind the apex,
// a preview deployment, or a custom domain alike, with no origin baked into the build. The
// document is small and cheap to serve, and the Cache-Control header below still lets it be
// cached at the edge per-origin. The origin rule itself lives in lib/openapi-origin.ts -- a
// route module may not export anything but handlers and config.
export const dynamic = "force-dynamic";

/*
  G3-030 and G3-020, as two helpers rather than as 33 hand-written response objects.

  What the audit found: zero summaries, zero tags, zero examples, zero success schemas, and
  twenty-four of thirty-three operations reducing every error to the same seven words, "Bounded
  error with a stable machine code". A generated client typed every success payload as `any` and
  no rendered reference could group anything, because there was nothing to group by.

  `ok()` and `err()` fix the shape of the answer rather than the wording of one operation.
  `err()` in particular takes code names and builds the description from `lib/api-error-codes.ts`,
  so the spec cannot name a code the catalogue has never heard of -- `apiErrorCode` throws -- and
  a code whose meaning changes changes here in the same edit.
*/

type Schema = Record<string, unknown>;

/** A 2xx with a schema and one example. Both are required: `ok()` has no one-argument form. */
function ok(description: string, schema: Schema, example: unknown) {
  return { description, content: { "application/json": { schema, examples: { default: { value: example } } } } };
}

/** An error response whose description enumerates the codes this operation actually returns. */
function err(...codes: string[]) {
  const entries = codes.map(apiErrorCode);
  return {
    description: entries.map((entry) => `${entry.code}  ${entry.meaning}`).join(" "),
    "x-tavonel-error-codes": codes,
    content: {
      "application/json": {
        schema: {
          allOf: [{ $ref: "#/components/schemas/Error" }],
          properties: { code: { enum: codes } },
        },
        examples: { default: { value: { code: codes[0] } } },
      },
    },
  };
}

/*
  `additionalProperties: true` with `x-tavonel-status: "best-effort"` is a deliberate admission.

  Some handlers compose their payload from a store row this document does not own, so naming
  every field here would be transcribing a shape that can move without this file noticing. Those
  schemas declare the fields a caller can rely on and say, in the extension, that the object is
  described rather than closed. The alternative -- a closed schema listing fields nobody
  verified -- is the kind of invented data the constitution bars, and a generated client built on
  it would break on the first field it did not expect.
*/
const bestEffort = { "x-tavonel-status": "best-effort", additionalProperties: true } as const;

const str = { type: "string" } as const;
const nullableStr = { type: ["string", "null"] } as const;
const int = { type: "integer" } as const;

export function GET(request: Request) {
  if (request.headers.get("accept")?.includes("text/html")) {
    return NextResponse.redirect(new URL("/api", request.url), 302);
  }
  const origin = resolveOpenApiOrigin(request.url);
  const v1 = `${origin}/api/v1`;
  /*
    G3-001. The compile routes live at /api/compile-jobs, not under /api/v1, so all seven of them
    resolved to a 404 for anyone generating a client from `servers` alone -- compile, poll,
    stream, blockers and cancel, which is the entire path from "I uploaded a file" to "I have a
    World". Each of those paths carries its own `servers`, the same override /export/trust
    already used. `lib/openapi-routes.test.ts` now resolves every path and method in this
    document against the App Router's own files and fails the build when one does not exist, so the
    contract cannot describe a URL the application does not serve again.
  */
  const unversioned = [{ url: `${origin}/api` }];

  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "TAVONEL Knowledge Compiler API",
      version: API_VERSION,
      description: "Tenant-scoped access to immutable documents, candidate knowledge packages, active Worlds, grounded retrieval and durable connector cursors. Activation and rollback remain human-session-only.",
    },
    servers: [{ url: v1 }],
    security: [{ TavonelApiKey: [] }],
    /*
      G3-030's second half: a rendered reference groups by tag, and there were none. These are
      named after the job a reader is doing, which is also the order /api renders them in.
    */
    tags: [
      { name: "Capabilities", description: "What TAVONEL can read, and who signs what it exports. No key required." },
      { name: "Documents", description: "Direct-to-storage upload, and the immutable document inventory it produces." },
      { name: "Compile", description: "Turning a document set into a candidate Compiled World, and following the run." },
      { name: "Worlds", description: "Reading an active World, its lenses, its retrieval index and its version state." },
      { name: "Questions", description: "Grounded answers and retrieval-only search over the active World." },
      { name: "Review", description: "Append-only human decisions over evidence, and the observed run-event stream." },
      { name: "Connections", description: "Durable source connections, their cursors, and the OAuth connectors that create them." },
      { name: "Workspace administration", description: "Key rotation and the audit trail. Browser session only  no API key calls these." },
    ],
    paths: {
      /*
        The capability manifest, unauthenticated, because deciding whether to send us a file
        should not require a key. It is the same list `/uploads/capability` validates against 
        the enum below is generated from it  so the spec cannot advertise a MIME type the
        upload route refuses.
      */
      "/capabilities": {
        get: {
          operationId: "getCapabilityManifest",
          summary: "Read the capability manifest",
          tags: ["Capabilities"],
          security: [],
          description: "Every source format TAVONEL can read, with its support tier, what survives into the compiled World, its known limitations and its qualification receipt when one exists. A verified tier without a receipt is not representable. Anything absent from the manifest is refused at upload. The two per-source ceilings TAVONEL enforces  bytes and pages  are published here as `knownLimitations` tokens.",
          responses: {
            "200": ok(
              "The capability manifest and the sha256 of its serialized form. `contentSha256` is taken over the manifest without that field: delete it, re-serialize with the key order unchanged, and hash.",
              { $ref: "#/components/schemas/CapabilityManifest" },
              {
                schemaVersion: "tavonel.capability_manifest.v1",
                defaultStatus: "UNSUPPORTED",
                entries: [{
                  sourceFamily: "pdf",
                  mime: "application/pdf",
                  extensions: ["pdf"],
                  status: "BEST_EFFORT",
                  preserved: ["page", "paragraph_text", "bbox1000"],
                  knownLimitations: ["read_through_cdr_sanitized_pdf_and_ocr", "no_table_or_formula_extraction", "at_most_5_mib_per_source", "at_most_80_pages_per_source"],
                  qualifiedAt: null,
                  qualificationReceipt: null,
                }],
                contentSha256: "sha256:<64 hex>",
              },
            ),
          },
        },
      },
      /*
        The signing fingerprint, unauthenticated, and at /api rather than /api/v1 like the
        capability manifest above it.

        It is the only way a holder gets the public key from OUTSIDE the archive, which is the
        entire basis of the offline verification the portable-world clause promises -- an archive
        that vouches for its own key has proven nothing. The route existed and answered and was
        simply absent from this document, so an SDK generated from the contract had no method for
        the one call a verification flow cannot skip.
      */
      "/export/trust": {
        servers: unversioned,
        get: {
          operationId: "getExportTrustRecord",
          summary: "Read the export signing key",
          tags: ["Capabilities"],
          security: [],
          description: "The Ed25519 public key every signed export is signed with, and its sha256 fingerprint. Fetched here rather than read out of an archive, because an archive that vouches for its own key has proven nothing. A deployment with no signing key configured answers 503 EXPORT_SIGNER_NOT_CONFIGURED rather than a fingerprint nobody can verify against.",
          responses: {
            "200": ok(
              "The trust record. Verify a downloaded archive against `publicKeySpkiSha256` from here, never against a fingerprint inside the archive.",
              {
                type: "object",
                required: ["schemaVersion", "algorithm", "keyId", "publicKeySpkiDerBase64", "publicKeySpkiSha256"],
                properties: {
                  schemaVersion: str, algorithm: str, keyId: str,
                  publicKeySpkiDerBase64: str, publicKeySpkiSha256: str,
                },
              },
              {
                schemaVersion: "tavonel.export_trust.v1",
                algorithm: "Ed25519",
                keyId: "<key id>",
                publicKeySpkiDerBase64: "<base64 SPKI>",
                publicKeySpkiSha256: "sha256:<64 hex>",
              },
            ),
            "503": err("EXPORT_SIGNER_NOT_CONFIGURED", "EXPORT_SIGNER_INVALID"),
          },
        },
      },
      "/uploads/quote": {
        post: {
          operationId: "quoteApprovedUploadSet",
          summary: "Quote a complete upload set before approval",
          tags: ["Documents"],
          "x-tavonel-scope": "documents:intake",
          description: "Returns a no-hold quote for the complete selected manifest. It creates no approval, admission reservation, or compute ledger entry. The caller must compare maximumCredits with its own explicitly authorized budget and present any changed or higher quote for review. POST /uploads/approval recomputes price and refuses a stale quote.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: {
              type: "object", required: ["clientManifestDigest", "files"], additionalProperties: false,
              properties: {
                clientManifestDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
                files: { type: "array", minItems: 1, maxItems: MAX_APPROVAL_FILES, items: { $ref: "#/components/schemas/IntakeManifestEntry" } },
              },
            }, examples: { default: { value: { clientManifestDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", files: [{ fileKey: "fk_0123456789abcdef0123456789abcdef01234567", originalFilename: "manual.pdf", contentSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", byteLength: 184320, mimeType: "application/pdf", claimedPages: null, claimedBasis: null }] } } } } } },
          responses: {
            "200": ok("A no-hold quote for every member and the aggregate maximum. Persist this response with the same attempt and manifest before asking for approval.", { $ref: "#/components/schemas/IntakeQuote" }, { code: "INTAKE_QUOTE", clientManifestDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", pricingFingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", metadataLimitBytes: MAX_APPROVAL_METADATA_BYTES, quote: { maximumPages: 80, reservedCredits: 32, maximumCredits: 160, estimatedUsd: 0.32, maximumUsd: 1.6 }, files: [{ fileKey: "fk_0123456789abcdef0123456789abcdef01234567", pageBasis: "unknown", approvedMaxPages: 80, reservedCredits: 32, maximumCredits: 160 }] }),
            "400": { description: "Malformed, duplicate, or digest-mismatched manifest.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "401": err("AUTH_REQUIRED", "API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_REVOKED"),
            "403": err("API_SCOPE_REQUIRED", "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE"),
            "413": { description: "Manifest metadata exceeds the bounded request size.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "503": { description: "Intake is unavailable or pricing could not be safely quoted.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/uploads/approval": {
        get: {
          operationId: "getUploadApproval",
          summary: "Read an upload attempt's approval state",
          tags: ["Documents"],
          "x-tavonel-scope": "documents:intake",
          parameters: [{ name: "attemptKey", in: "query", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } }],
          responses: {
            "200": ok("The current state of this caller's attempt, including its stable approval, scope and per-file document identities. Read after a reload or an uncertain approval/confirmation reply.", { type: "object", required: ["code", "approval"], properties: { code: { const: "INTAKE_APPROVAL" }, approval: { $ref: "#/components/schemas/UploadApproval" } } }, { code: "INTAKE_APPROVAL", approval: { approvalId: "22222222-2222-4222-8222-222222222222", attemptKey: "att_0123456789abcdef0123456789abcdef", clientManifestDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", scopeDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", pricingFingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", state: "approved", aggregateMaximumCredits: 160, files: [{ fileKey: "fk_0123456789abcdef0123456789abcdef01234567", documentId: "33333333-3333-4333-8333-333333333333", fileState: "approved", approvedMaximumCredits: 160 }] } }),
            "400": { description: "Attempt key is invalid.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "401": err("AUTH_REQUIRED", "API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_REVOKED"),
          },
        },
        post: {
          operationId: "createUploadApproval",
          summary: "Approve one complete quoted upload set",
          tags: ["Documents"],
          "x-tavonel-scope": "documents:intake",
          description: "The caller supplies the exact whole-set manifest, the quoted pricing fingerprint and its exact aggregate maximum. The server recomputes pricing and atomically records one approval and all file identities. A changed quote is returned as a conflict and is never approved implicitly.",
          requestBody: { required: true, content: { "application/json": { schema: {
            type: "object", required: ["attemptKey", "clientManifestDigest", "pricingFingerprint", "aggregateMaximumCredits", "files"], additionalProperties: false,
            properties: { attemptKey: { type: "string", minLength: 16, maxLength: 128 }, clientManifestDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, pricingFingerprint: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, aggregateMaximumCredits: { type: "integer", minimum: 0 }, files: { type: "array", minItems: 1, maxItems: MAX_APPROVAL_FILES, items: { $ref: "#/components/schemas/IntakeManifestEntry" } } },
            }, examples: { default: { value: { attemptKey: "att_0123456789abcdef0123456789abcdef", clientManifestDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", pricingFingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", aggregateMaximumCredits: 160, files: [{ fileKey: "fk_0123456789abcdef0123456789abcdef01234567", originalFilename: "manual.pdf", contentSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", byteLength: 184320, mimeType: "application/pdf", claimedPages: null, claimedBasis: null }] } } } } } },
          responses: {
            "200": ok("The committed approval, stable document ids, and exact quote the caller approved.", { type: "object", required: ["code", "approval", "quote"], properties: { code: { const: "INTAKE_APPROVED" }, approval: { $ref: "#/components/schemas/UploadApproval" }, quote: { $ref: "#/components/schemas/UploadQuoteTotals" } } }, { code: "INTAKE_APPROVED", approval: { approvalId: "22222222-2222-4222-8222-222222222222", attemptKey: "att_0123456789abcdef0123456789abcdef", clientManifestDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", scopeDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", pricingFingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", state: "approved", aggregateMaximumCredits: 160, files: [{ fileKey: "fk_0123456789abcdef0123456789abcdef01234567", documentId: "33333333-3333-4333-8333-333333333333", fileState: "approved", approvedMaximumCredits: 160 }] }, quote: { maximumPages: 80, reservedCredits: 32, maximumCredits: 160, estimatedUsd: 0.32, maximumUsd: 1.6 } }),
            "400": { description: "Malformed request or manifest.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "401": err("AUTH_REQUIRED", "API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_REVOKED"),
            "409": { description: "Pricing or the quoted aggregate changed. Review the returned quote; no approval was created.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "503": { description: "The approval could not be committed; read GET /uploads/approval for this attempt before retrying.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/uploads/approval/cancel": {
        post: {
          operationId: "cancelApprovedUploadSet",
          summary: "Cancel a complete approved upload set",
          tags: ["Documents"],
          "x-tavonel-scope": "documents:intake",
          description: "Cancels the caller's entire approved attempt and releases any remaining reserved member holds. The request names one member as an identity anchor; the server revalidates the caller, attempt, scope digest and member against the stored approval before it atomically cancels the set. A reconciliation-required result means a member may already have settled and needs operator review.",
          requestBody: { required: true, content: { "application/json": { schema: {
            type: "object", required: ["attemptKey", "scopeDigest", "fileKey"], additionalProperties: false,
            properties: { attemptKey: { type: "string", minLength: 16, maxLength: 128 }, scopeDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, fileKey: { type: "string", minLength: 8, maxLength: 128 } },
            }, examples: { default: { value: { attemptKey: "att_0123456789abcdef0123456789abcdef", scopeDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", fileKey: "fk_0123456789abcdef0123456789abcdef01234567" } } } } } },
          responses: {
            "200": ok("The complete approval was cancelled. A reconciliationRequired result flags a member that may already have settled.", { type: "object", required: ["code", "result"], properties: { code: { enum: ["INTAKE_SET_CANCELLED", "INTAKE_SET_CANCELLED_RECONCILIATION_REQUIRED"] }, result: { type: "object", required: ["status", "reconciliationRequired"], properties: { status: { type: "string" }, reconciliationRequired: { type: "boolean" } } } } }, { code: "INTAKE_SET_CANCELLED", result: { status: "cancelled", reconciliationRequired: false } }),
            "400": err("INTAKE_APPROVAL_CANCEL_INVALID"),
            "401": err("AUTH_REQUIRED", "API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_REVOKED"),
            "403": err("API_SCOPE_REQUIRED"),
            "409": err("INTAKE_APPROVAL_CONFLICT", "INTAKE_APPROVAL_FILE_OUT_OF_SCOPE"),
            "503": { description: "The cancellation ledger could not be safely updated; retry with the same attempt, scope and member identity.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/uploads/capability": {
        post: {
          operationId: "createDirectUploadCapability",
          summary: "Request an approved direct upload URL",
          tags: ["Documents"],
          "x-tavonel-scope": "documents:intake",
          description: "Returns a short-lived direct PUT URL only for an exact member of an approved complete set. Send the approval's attemptKey, scopeDigest, pricingFingerprint, fileKey and exact contentSha256, and the stable x-tavonel-source-idempotency-key derived from attemptKey and fileKey. The API key authenticates this call only; never send it to storage. Document bytes never pass through the application server.",
          requestBody: { required: true, content: { "application/json": { schema: {
            type: "object", required: ["originalFilename", "declaredMimeType", "requestedBytes", "attemptKey", "scopeDigest", "pricingFingerprint", "fileKey", "contentSha256"], additionalProperties: false,
            properties: { originalFilename: { type: "string", minLength: 1, maxLength: 255 }, declaredMimeType: { type: "string", enum: Object.keys(qualifiedDocumentInputs) }, requestedBytes: { type: "integer", minimum: 1, maximum: 524288000 }, attemptKey: { type: "string", minLength: 16, maxLength: 128 }, scopeDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, pricingFingerprint: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, fileKey: { type: "string", minLength: 8, maxLength: 128 }, contentSha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } },
            }, examples: { default: { value: { originalFilename: "manual.pdf", declaredMimeType: "application/pdf", requestedBytes: 184320, attemptKey: "att_0123456789abcdef0123456789abcdef", scopeDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", pricingFingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", fileKey: "fk_0123456789abcdef0123456789abcdef01234567", contentSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } } } } } },
          parameters: [{ $ref: "#/components/parameters/SourceIdempotencyKey" }],
          responses: {
            "200": ok("An approved member's direct PUT capability and its already-persisted document identity.", { type: "object", required: ["code", "documentId", "uploadUrl", "contentLength", "declaredMimeType", "computeReservation"], properties: { code: { const: "QUALIFIED" }, documentId: { type: "string", format: "uuid" }, uploadUrl: { type: "string", format: "uri", description: "Presigned object-storage URL. The API key is never sent to it." }, contentLength: { type: "integer" }, declaredMimeType: str, computeReservation: { type: "object", required: ["reservationId", "maximumCredits"], properties: { reservationId: str, maximumCredits: int, reservedCredits: int, billingSource: str, expiresAt: { type: "string", format: "date-time" }, quote: bestEffort }, ...bestEffort } } }, { code: "QUALIFIED", documentId: "33333333-3333-4333-8333-333333333333", uploadUrl: "https://<storage-host>/quarantine/...?X-Amz-Signature=...", contentLength: 184320, declaredMimeType: "application/pdf", computeReservation: { reservationId: "reservation_example", maximumCredits: 160, reservedCredits: 32, billingSource: "subscription" } }),
            "400": { description: "Malformed member or identity.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "401": err("AUTH_REQUIRED", "API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_REVOKED"),
            "403": err("API_SCOPE_REQUIRED", "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE"),
            "409": { description: "The approved manifest, scope or quote no longer matches.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "413": err("SOURCE_EXCEEDS_PROCESSING_CEILING", "TRIAL_FILE_TOO_LARGE"),
            "428": { description: "The caller has not provided a matching approval identity and stable idempotency key.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "503": err("SIGNER_NOT_CONFIGURED", "INTAKE_DISABLED"),
          },
        },
      },
      "/uploads/confirm": {
        post: {
          operationId: "confirmApprovedUpload",
          summary: "Atomically confirm stored bytes for an approved member",
          tags: ["Documents"],
          "x-tavonel-scope": "documents:intake",
          description: "After the direct PUT succeeds, submit its digest with the same attempt, scope and member identity. The server verifies the stored object and commits confirmation and ledger state atomically. Do not treat the PUT response as confirmation.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["documentId", "sourceSha256", "attemptKey", "scopeDigest", "fileKey"], additionalProperties: false, properties: { documentId: { type: "string", format: "uuid" }, sourceSha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, attemptKey: { type: "string", minLength: 16, maxLength: 128 }, scopeDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, fileKey: { type: "string", minLength: 8, maxLength: 128 } } }, examples: { default: { value: { documentId: "33333333-3333-4333-8333-333333333333", sourceSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", attemptKey: "att_0123456789abcdef0123456789abcdef", scopeDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", fileKey: "fk_0123456789abcdef0123456789abcdef01234567" } } } } } },
          responses: { "200": ok("The confirmed approval member and atomic admission receipt.", { type: "object", required: ["code", "approvedFile"], properties: { code: { const: "UPLOAD_CONFIRMED" }, approvedFile: { $ref: "#/components/schemas/UploadApprovalFile" }, result: bestEffort } }, { code: "UPLOAD_CONFIRMED", approvedFile: { fileKey: "fk_0123456789abcdef0123456789abcdef01234567", documentId: "33333333-3333-4333-8333-333333333333", fileState: "confirmed" }, result: { documentId: "33333333-3333-4333-8333-333333333333", status: "confirmed" } }), "401": err("AUTH_REQUIRED", "API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_REVOKED"), "403": err("API_SCOPE_REQUIRED", "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE"), "409": { description: "The object or approved identity does not match; no confirmation is acknowledged.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }, "428": { description: "Matching approval identity is required.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
        },
      },
      "/uploads/release": {
        post: {
          operationId: "releaseFailedApprovedUpload",
          summary: "Release an approved hold after a definitive PUT refusal",
          tags: ["Documents"],
          "x-tavonel-scope": "documents:intake",
          description: "A client may call this only after a definitive storage PUT refusal. The server checks storage for an already-landed object before cancelling the approved member. A lost or uncertain PUT response must be retried and confirmed, never released.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["documentId", "attemptKey", "fileKey"], additionalProperties: false, properties: { documentId: { type: "string", format: "uuid" }, attemptKey: { type: "string", minLength: 16, maxLength: 128 }, fileKey: { type: "string", minLength: 8, maxLength: 128 } } }, examples: { default: { value: { documentId: "33333333-3333-4333-8333-333333333333", attemptKey: "att_0123456789abcdef0123456789abcdef", fileKey: "fk_0123456789abcdef0123456789abcdef01234567" } } } } } },
          responses: { "200": ok("The approved hold was released after the object store confirmed the object was absent.", { type: "object", required: ["code", "result"], properties: { code: { const: "UPLOAD_CREDITS_RELEASED" }, result: bestEffort } }, { code: "UPLOAD_CREDITS_RELEASED", result: { fileKey: "fk_0123456789abcdef0123456789abcdef01234567", fileState: "cancelled" } }), "401": err("AUTH_REQUIRED", "API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_REVOKED"), "409": { description: "The object is already stored or the approved identity does not match.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }, "428": { description: "Matching approval identity is required.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }, "503": { description: "The object store or release ledger is unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
        },
      },
      "/documents": {
        get: {
          operationId: "listDocuments",
          summary: "List documents",
          tags: ["Documents"],
          "x-tavonel-scope": "documents:read",
          description: "The workspace's immutable document inventory with each document's processing state and version key. Uploading the same file twice produces two documents that share one content digest; nothing merges them. This operation takes no paging parameters  the inventory is returned whole.",
          responses: {
            "200": ok(
              "{ code: OK, workspaceId, documents }. A document whose source could not be resolved is present with its refusal rather than omitted.",
              {
                type: "object",
                required: ["code", "workspaceId", "documents"],
                properties: {
                  code: { const: "OK" },
                  workspaceId: str,
                  documents: { type: "array", items: { $ref: "#/components/schemas/Document" } },
                },
              },
              {
                code: "OK",
                workspaceId: "pilot-<workspace>",
                documents: [{
                  documentId: "00000000-0000-4000-8000-000000000000",
                  originalFilename: "manual.pdf",
                  mimeType: "application/pdf",
                  state: "ready",
                  sourceVersionKey: "src_v_<id>",
                  createdAt: "2026-09-16T00:00:00.000Z",
                }],
              },
            ),
            "401": err("AUTH_REQUIRED", "API_KEY_INVALID"),
            "403": err("API_SCOPE_REQUIRED", "PILOT_ACCESS_REQUIRED", "CONNECTOR_SOURCE_ACCESS_DENIED", "AUTHORIZATION_CHANGED_RETRY"),
            "429": err("API_RATE_LIMITED"),
            "503": err("CONNECTOR_SOURCE_ACCESS_UNAVAILABLE", "READ_FAILED", "API_RATE_LIMIT_UNAVAILABLE"),
          },
        },
      },
      "/collections/compile": {
        post: {
          operationId: "compileCollection",
          summary: "Compile one document set, synchronously",
          tags: ["Compile"],
          "x-tavonel-scope": "collections:compile",
          description: "Compiles a single document set and waits for the artifact. Bounded to what one compile carries; a larger selection belongs on POST /compile-jobs, which partitions it server-side and survives a closed tab. The result is a candidate: `candidatePromotion` is always false, because activation is a human decision in a signed-in session and no key holds it.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", required: ["documentIds"], properties: { documentIds: { type: "array", minItems: 1, maxItems: 12, uniqueItems: true, items: { type: "string", pattern: "^[0-9a-f-]{36}$" } } } },
                examples: { default: { value: { documentIds: ["00000000-0000-4000-8000-000000000000"] } } },
              },
            },
          },
          responses: {
            "200": ok(
              "An immutable candidate package receipt. `candidatePromotion` is always false.",
              { $ref: "#/components/schemas/CandidateReceipt" },
              {
                code: "COLLECTION_CANDIDATE_READY",
                collectionId: "collection-<32 hex>",
                manifestDigest: "sha256:<64 hex>",
                candidatePromotion: false,
                documentsTotal: 1,
              },
            ),
            "400": err("DOCUMENT_IDS_REQUIRED", "DOCUMENT_SET_EMPTY", "DOCUMENT_SET_UNQUALIFIED", "DOCUMENT_SET_TOO_LARGE", "INVALID_JSON"),
            "401": err("AUTH_REQUIRED"),
            "402": err("STUDIO_SUBSCRIPTION_REQUIRED", "TRIAL_DURABLE_COMPILE_REQUIRED", "GPU_CREDITS_REQUIRED"),
            "403": err("API_SCOPE_REQUIRED", "PILOT_ACCESS_REQUIRED"),
            "409": err("OCR_NOT_READY", "SOURCE_VERSION_AMBIGUOUS"),
            "415": err("METADATA_ONLY_ENDPOINT"),
            "429": err("API_RATE_LIMITED", "WORKSPACE_CONCURRENCY_LIMIT"),
            "503": err("CORE_NOT_CONFIGURED", "CORE_UNAVAILABLE"),
          },
        },
      },
      /*
        Durable compile orchestration.

        These sit at /api/compile-jobs rather than under /api/v1, so each carries its own
        server. That is not tidy and it is accurate: the versioned developer surface and the
        workspace's own orchestration are different contracts with different stability
        promises, and pretending otherwise in the spec would mislead anyone generating a client.
      */
      "/compile-jobs": {
        servers: unversioned,
        post: {
          operationId: "startCompileJob",
          summary: "Start a durable compile",
          tags: ["Compile"],
          "x-tavonel-scope": "collections:compile",
          description: "Records the intent to compile and returns immediately. The job advances on the server whether or not the caller stays connected, which is the difference between this and /v1/collections/compile. Submitting the same document set again returns the job that already exists rather than starting a second compile. A selection larger than one compile can carry is partitioned server-side into parts and answered with COMPILE_CORPUS_ACCEPTED and a corpusId instead of a jobId; each part is an ordinary compile job with its own id, state and event stream.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", required: ["documentIds"], properties: { documentIds: { type: "array", minItems: 1, maxItems: 128, uniqueItems: true, items: { type: "string", pattern: "^[0-9a-f-]{36}$" } } }, additionalProperties: false },
                examples: { default: { value: { documentIds: ["00000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000001"] } } },
              },
            },
          },
          responses: {
            "202": ok(
              "Accepted. A single job returns { code: COMPILE_JOB_ACCEPTED, jobId, state, documentsTotal }; a partitioned selection returns { code: COMPILE_CORPUS_ACCEPTED, corpusId, batchCount, parts } instead, and each part is an ordinary compile job with its own id. `Location` names whichever resource was created.",
              {
                oneOf: [
                  { $ref: "#/components/schemas/CompileJobAccepted" },
                  { $ref: "#/components/schemas/CompileCorpusAccepted" },
                ],
              },
              { code: "COMPILE_JOB_ACCEPTED", jobId: "cjob-<32 hex>", state: "queued", documentsTotal: 2 },
            ),
            "400": err("DOCUMENT_IDS_REQUIRED", "DOCUMENT_SET_EMPTY", "DOCUMENT_SET_UNQUALIFIED", "CORPUS_TOO_LARGE", "SPLIT_PART_LIMIT_EXCEEDED", "INVALID_JSON"),
            "401": err("AUTH_REQUIRED"),
            "402": err("STUDIO_SUBSCRIPTION_REQUIRED", "TRIAL_WORLD_LIMIT_REACHED", "GPU_CREDITS_REQUIRED"),
            "403": err("API_SCOPE_REQUIRED", "PILOT_ACCESS_REQUIRED"),
            "409": err("COMPILE_JOB_SLOT_CONFLICT", "SOURCE_VERSION_AMBIGUOUS"),
            "415": err("METADATA_ONLY_ENDPOINT"),
            "429": err("API_RATE_LIMITED", "WORKSPACE_CONCURRENCY_LIMIT", "COMPILE_JOB_WORKSPACE_LIMIT_REACHED"),
            "503": err("COMPILE_JOB_STORE_NOT_CONFIGURED", "COMPILE_JOB_STORE_WRITE_FAILED", "COMPILE_JOB_RPC_UNDEFINED"),
          },
        },
        get: {
          operationId: "listCompileJobs",
          summary: "List recent compiles",
          tags: ["Compile"],
          "x-tavonel-scope": "collections:read",
          description: "The workspace's recent compiles, newest first, so a client that lost its job id can pick a run back up. Takes no paging parameters.",
          responses: {
            "200": ok(
              "{ code: OK, jobs }, newest first.",
              { type: "object", required: ["code", "jobs"], properties: { code: { const: "OK" }, jobs: { type: "array", items: { $ref: "#/components/schemas/CompileJob" } } } },
              {
                code: "OK",
                jobs: [{
                  jobId: "cjob-<32 hex>", state: "compiled", collectionId: "collection-<32 hex>",
                  documentIds: ["00000000-0000-4000-8000-000000000000"], documentsTotal: 1, documentsReady: 1,
                  blocked: [], blockedResolution: null, errorCode: null,
                  corpusId: null, batchIndex: null, batchCount: null,
                  createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:02:00.000Z", settledAt: "2026-09-16T00:02:00.000Z",
                }],
              },
            ),
            "401": err("AUTH_REQUIRED"),
            "403": err("API_SCOPE_REQUIRED", "PILOT_ACCESS_REQUIRED"),
            "429": err("API_RATE_LIMITED"),
            "503": err("COMPILE_JOB_STORE_READ_FAILED", "COMPILE_JOB_STORE_NOT_CONFIGURED"),
          },
        },
      },
      "/compile-jobs/corpus/{corpusId}": {
        servers: unversioned,
        get: {
          operationId: "getCompileCorpus",
          summary: "Read a partitioned run",
          tags: ["Compile"],
          "x-tavonel-scope": "collections:read",
          parameters: [{ name: "corpusId", in: "path", required: true, schema: { type: "string", pattern: "^corpus-[a-f0-9]{32}$" } }],
          description: "A partitioned run, summarised from its parts. There is no stored roll-up: the state is computed from the part rows every time, so it cannot disagree with them. `partial` means some parts compiled and at least one did not -- the Worlds that exist are usable, and reporting that as ready would hide missing sources.",
          responses: {
            "200": ok(
              "Corpus state, part list and aggregate progress.",
              { $ref: "#/components/schemas/CompileCorpus" },
              {
                code: "OK", corpusId: "corpus-<32 hex>", state: "partial",
                documentsTotal: 20, documentsReady: 12, partsEnqueued: 2, batchCount: 2,
                incompleteReason: null,
                parts: [
                  { jobId: "cjob-<32 hex>", batchIndex: 0, batchCount: 2, state: "compiled", collectionId: "collection-<32 hex>", documentsTotal: 12, documentsReady: 12, errorCode: null },
                  { jobId: "cjob-<32 hex>", batchIndex: 1, batchCount: 2, state: "blocked", collectionId: null, documentsTotal: 8, documentsReady: 0, errorCode: null },
                ],
              },
            ),
            "400": err("CORPUS_ID_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "404": err("NOT_FOUND"),
            "503": err("COMPILE_JOB_STORE_READ_FAILED"),
          },
        },
      },
      "/compile-jobs/{jobId}": {
        servers: unversioned,
        get: {
          operationId: "getCompileJob",
          summary: "Read one compile job",
          tags: ["Compile"],
          "x-tavonel-scope": "collections:read",
          parameters: [{ $ref: "#/components/parameters/CompileJobId" }],
          description: "The durable current state. A poller against this sees exactly what a stream subscriber sees, because both read the same row. A job id from another workspace answers not found, which is also all it should reveal.",
          responses: {
            "200": ok(
              "{ code: OK, job }, including any blocked documents and the resolution recorded against them.",
              { type: "object", required: ["code", "job"], properties: { code: { const: "OK" }, job: { $ref: "#/components/schemas/CompileJob" } } },
              {
                code: "OK",
                job: {
                  jobId: "cjob-<32 hex>", state: "blocked", collectionId: null,
                  documentIds: ["00000000-0000-4000-8000-000000000000"], documentsTotal: 1, documentsReady: 0,
                  blocked: [{ documentId: "00000000-0000-4000-8000-000000000000", reason: "security", retryable: false }],
                  blockedResolution: null, errorCode: null,
                  corpusId: null, batchIndex: null, batchCount: null,
                  createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:01:00.000Z", settledAt: null,
                },
              },
            ),
            "400": err("COMPILE_JOB_SCOPE_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "404": err("COMPILE_JOB_NOT_FOUND"),
            "503": err("COMPILE_JOB_STORE_READ_FAILED"),
          },
        },
      },
      "/compile-jobs/{jobId}/events": {
        servers: unversioned,
        get: {
          operationId: "streamCompileJobEvents",
          summary: "Stream compile transitions",
          tags: ["Compile"],
          "x-tavonel-scope": "collections:read",
          parameters: [{ $ref: "#/components/parameters/CompileJobId" }, { $ref: "#/components/parameters/LastEventId" }],
          description: "Replays the persisted transition log after Last-Event-ID, then follows it. The server closes the stream at its own wall clock, so reconnecting is the normal case rather than an error path; every frame carries the durable sequence to resume from. Nothing is lost when a connection drops, because the events are written before they are sent and nothing was ever only in the connection.",
          responses: {
            "200": {
              description: "text/event-stream of persisted compile transitions. Each frame's `id` is the durable sequence; echo it back as Last-Event-ID to resume.",
              content: {
                "text/event-stream": {
                  schema: { type: "string" },
                  examples: { default: { value: "id: 42\nevent: state\ndata: {\"jobId\":\"cjob-<32 hex>\",\"state\":\"compiling\",\"documentsTotal\":1,\"documentsReady\":0}\n\n" } },
                },
              },
            },
            "400": err("COMPILE_JOB_SCOPE_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "404": err("COMPILE_JOB_NOT_FOUND"),
          },
        },
      },
      "/compile-jobs/{jobId}/blockers": {
        servers: unversioned,
        post: {
          operationId: "resolveCompileJobBlockers",
          summary: "Answer a partial failure",
          tags: ["Compile"],
          "x-tavonel-scope": "collections:compile",
          parameters: [{ $ref: "#/components/parameters/CompileJobId" }],
          description: "Answers a partial failure. A job with blocked documents stops and waits; nothing skips them by itself. `continue` is refused while any blocker is a security blocker -- those leave the set through `remove_blocked`, which records who removed them.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", required: ["resolution"], properties: { resolution: { type: "string", enum: ["continue", "remove_blocked", "retry_eligible"] } }, additionalProperties: false },
                examples: { default: { value: { resolution: "remove_blocked" } } },
              },
            },
          },
          responses: {
            "200": ok(
              "The recorded resolution and the job it applies to.",
              { type: "object", required: ["code", "job"], properties: { code: { const: "OK" }, job: { $ref: "#/components/schemas/CompileJob" } } },
              {
                code: "OK",
                job: {
                  jobId: "cjob-<32 hex>", state: "queued", collectionId: null,
                  documentIds: ["00000000-0000-4000-8000-000000000000"], documentsTotal: 1, documentsReady: 0,
                  blocked: [], blockedResolution: "remove_blocked", errorCode: null,
                  corpusId: null, batchIndex: null, batchCount: null,
                  createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:03:00.000Z", settledAt: null,
                },
              },
            ),
            "400": err("RESOLUTION_REQUIRED", "INVALID_JSON", "COMPILE_JOB_SCOPE_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "404": err("COMPILE_JOB_NOT_FOUND"),
            "409": err("SECURITY_BLOCKER_REQUIRES_EXPLICIT_REMOVAL", "RESOLUTION_NOT_APPLIED", "COMPILE_JOB_ALREADY_SETTLED"),
            "415": err("METADATA_ONLY_ENDPOINT"),
          },
        },
      },
      "/compile-jobs/{jobId}/cancel": {
        servers: unversioned,
        post: {
          operationId: "cancelCompileJob",
          summary: "Cancel a compile job",
          tags: ["Compile"],
          "x-tavonel-scope": "collections:compile",
          parameters: [{ $ref: "#/components/parameters/CompileJobId" }],
          description: "Marks the job cancelled. A job that had already settled is left alone -- a cancel arriving a second after a compile finished does not destroy the result.",
          responses: {
            "200": ok(
              "The cancelled job.",
              { type: "object", required: ["code", "job"], properties: { code: { const: "OK" }, job: { $ref: "#/components/schemas/CompileJob" } } },
              {
                code: "OK",
                job: {
                  jobId: "cjob-<32 hex>", state: "cancelled", collectionId: null,
                  documentIds: ["00000000-0000-4000-8000-000000000000"], documentsTotal: 1, documentsReady: 0,
                  blocked: [], blockedResolution: null, errorCode: null,
                  corpusId: null, batchIndex: null, batchCount: null,
                  createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:04:00.000Z", settledAt: "2026-09-16T00:04:00.000Z",
                },
              },
            ),
            "401": err("AUTH_REQUIRED"),
            "404": err("COMPILE_JOB_NOT_FOUND"),
            "409": err("COMPILE_JOB_ALREADY_SETTLED"),
          },
        },
      },
      /*
        Discovery. The MCP server documented the absence of this endpoint for three releases --
        an agent holding only an API key could not find out which collection ids existed
        without a person pasting one in. Only ACTIVE Worlds are listed: a candidate nobody
        promoted is not what the workspace answers from, and a list mixing the two would
        present unaccepted output as organizational truth.
      */
      "/collections": {
        get: {
          operationId: "listActiveWorlds",
          summary: "List active Compiled Worlds",
          tags: ["Worlds"],
          "x-tavonel-scope": "collections:read",
          description: "The calling workspace's active Compiled Worlds, keyset-paginated on collection id. `page.nextCursor` is the last collection id on this page, or null on the last page. The workspace comes from the credential; there is no workspace parameter.",
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 50, default: 25 } },
            { name: "cursor", in: "query", required: false, schema: { type: "string", pattern: "^collection-[a-f0-9]{32}$" } },
          ],
          responses: {
            "200": ok(
              "One page of active Worlds.",
              {
                type: "object",
                required: ["code", "collections", "page"],
                properties: {
                  code: { const: "COLLECTIONS_LISTED" },
                  collections: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["collectionId", "manifestDigest", "revision", "updatedAt"],
                      properties: { collectionId: str, manifestDigest: str, revision: int, updatedAt: str },
                    },
                  },
                  page: { $ref: "#/components/schemas/Page" },
                },
              },
              {
                code: "COLLECTIONS_LISTED",
                collections: [{ collectionId: "collection-<32 hex>", manifestDigest: "sha256:<64 hex>", revision: 3, updatedAt: "2026-09-16T00:00:00.000Z" }],
                page: { limit: 25, cursor: null, nextCursor: null },
              },
            ),
            "400": err("WORLD_PAGE_LIMIT_INVALID", "WORLD_PAGE_CURSOR_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "403": err("API_SCOPE_REQUIRED", "PILOT_ACCESS_REQUIRED"),
            "503": err("WORLD_STORE_READ_FAILED", "WORLD_STORE_NOT_CONFIGURED"),
          },
        },
      },
      "/collections/{id}": {
        get: {
          operationId: "getCollection",
          summary: "Read a candidate package",
          tags: ["Worlds"],
          "x-tavonel-scope": "collections:read",
          parameters: [{ $ref: "#/components/parameters/CollectionId" }],
          description: "The reviewable candidate artifact  the raw compile package, before anyone activated it. This is not the World read model: GET /world/{id} is that, and it answers only for a version a person activated.",
          responses: {
            "200": ok(
              "The candidate artifact and its validation report.",
              { type: "object", required: ["collectionId", "manifestDigest"], properties: { collectionId: str, manifestDigest: str, candidatePromotion: { const: false }, validation: { type: "object", ...bestEffort } }, ...bestEffort },
              { collectionId: "collection-<32 hex>", manifestDigest: "sha256:<64 hex>", candidatePromotion: false, validation: { status: "valid", reasons: [] } },
            ),
            "400": err("COLLECTION_ID_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "404": err("NOT_FOUND"),
            "422": err("COLLECTION_PACKAGE_INVALID", "COLLECTION_SOURCE_BINDING_INVALID"),
            "503": err("READ_FAILED", "R2_NOT_CONFIGURED"),
          },
        },
      },
      /*
        Rebuilding a derived cache, not promoting knowledge. Promotion compiles the retrieval
        index itself and never fails because of it; this is the recovery path for the state that
        can leave behind -- active World, index missing or failed -- so /ask can stop serving
        the excerpt fallback without anyone re-promoting a candidate.
      */
      "/collections/{id}/retrieval-index": {
        post: {
          operationId: "recompileRetrievalIndex",
          summary: "Rebuild the retrieval index",
          tags: ["Worlds"],
          "x-tavonel-scope": "collections:compile",
          parameters: [{ $ref: "#/components/parameters/CollectionId" }],
          description: "Compiles the retrieval index for the collection's ACTIVE World, and is a no-op returning alreadyCompiled: true when a completed run for that World version already exists. The manifest comes from the active pointer, so this cannot index a candidate nobody activated. Requires the workspace owner or admin role in addition to the scope, and the same plan bar activating a World takes. A rebuild that does not reach a queryable index answers 503 with RETRIEVAL_INDEX_NOT_COMPILED and the failure class in retrievalIndex.errorClass -- never 200.",
          responses: {
            "200": ok(
              "The index state after the run. `alreadyCompiled: true` means nothing was recompiled.",
              {
                type: "object",
                required: ["code", "alreadyCompiled", "activeWorld", "retrievalIndex"],
                properties: {
                  code: { const: "RETRIEVAL_INDEX_COMPILED" },
                  alreadyCompiled: { type: "boolean" },
                  activeWorld: { $ref: "#/components/schemas/ActiveWorldPointer" },
                  retrievalIndex: { $ref: "#/components/schemas/RetrievalIndexState" },
                },
              },
              {
                code: "RETRIEVAL_INDEX_COMPILED",
                alreadyCompiled: false,
                activeWorld: { collectionId: "collection-<32 hex>", manifestDigest: "sha256:<64 hex>", revision: 3, activatedAt: "2026-09-16T00:00:00.000Z" },
                retrievalIndex: { status: "compiled", errorClass: null, runId: "rrun-<id>", retrievalProfileId: "rprof-<id>" },
              },
            ),
            "400": err("COLLECTION_ID_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "402": err("STUDIO_SUBSCRIPTION_REQUIRED"),
            "403": err("RETRIEVAL_COMPILE_ROLE_REQUIRED", "API_SCOPE_REQUIRED", "PILOT_ACCESS_REQUIRED"),
            "404": err("NOT_FOUND"),
            "409": err("ACTIVE_WORLD_NOT_FOUND"),
            "429": err("ACTIVATION_RATE_LIMITED"),
            "503": err("RETRIEVAL_INDEX_NOT_COMPILED", "RETRIEVAL_COMPILE_NO_UNITS", "RETRIEVAL_COMPILE_EMBEDDING_PROVIDER_FAILED", "RETRIEVAL_COMPILE_SOURCE_BINDING_UNRESOLVED", "ACTIVATION_RATE_LIMIT_UNAVAILABLE"),
          },
        },
      },
      "/collections/{id}/download": {
        get: {
          operationId: "downloadCollection",
          summary: "Download the signed package",
          tags: ["Capabilities"],
          "x-tavonel-scope": "collections:download",
          parameters: [{ $ref: "#/components/parameters/CollectionId" }],
          description: "The signed, hash-verifiable ZIP. Signed or refused: there is no third outcome, and you never receive an archive still in the candidate state. Verify it against the fingerprint from GET /export/trust, never against one inside the archive.",
          responses: {
            "200": {
              description: "The signed package. `manifest/export-manifest.json` carries a digest for every file and `signatures/export-manifest.ed25519.json` is the detached Ed25519 signature over those bytes.",
              content: { "application/zip": { schema: { type: "string", contentEncoding: "binary" } } },
            },
            "400": err("COLLECTION_ID_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "404": err("NOT_FOUND"),
            "422": err("COLLECTION_PACKAGE_INVALID", "INVALID_SIGNATURE", "EVIDENCE_DANGLING"),
            "503": err("EXPORT_SIGNER_NOT_CONFIGURED", "SIGNATURE_READ_FAILED", "R2_NOT_CONFIGURED"),
          },
        },
      },
      "/collections/{id}/world": {
        get: {
          operationId: "getActiveWorld",
          summary: "Read the active World pointer",
          tags: ["Worlds"],
          "x-tavonel-scope": "worlds:read",
          parameters: [{ $ref: "#/components/parameters/CollectionId" }],
          description: "Which version this collection currently answers from, and which prior versions are retained. Use GET /world/{id} for the read model itself and GET /world/{id}/{lens} for one lens of it.",
          responses: {
            "200": ok(
              "The active pointer and the retained versions.",
              {
                type: "object",
                required: ["activeWorld", "versions"],
                properties: {
                  activeWorld: { $ref: "#/components/schemas/ActiveWorldPointer" },
                  versions: { type: "array", items: { type: "object", ...bestEffort } },
                },
                ...bestEffort,
              },
              {
                activeWorld: { collectionId: "collection-<32 hex>", manifestDigest: "sha256:<64 hex>", revision: 3, activatedAt: "2026-09-16T00:00:00.000Z" },
                versions: [{ manifestDigest: "sha256:<64 hex>", revision: 2, lifecycleStatus: "superseded" }],
              },
            ),
            "400": err("COLLECTION_ID_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "404": err("NOT_FOUND", "WORLD_NOT_FOUND"),
            "409": err("ACTIVE_WORLD_NOT_FOUND"),
            "503": err("WORLD_STORE_READ_FAILED"),
          },
        },
      },
      "/collections/{id}/ask": {
        post: {
          operationId: "askActiveWorld",
          summary: "Ask the active World a question",
          tags: ["Questions"],
          "x-tavonel-scope": "ask:read",
          parameters: [{ $ref: "#/components/parameters/CollectionId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", required: ["question"], properties: { question: { type: "string", minLength: 3, maxLength: 500 } } },
                examples: { default: { value: { question: "What is the stated revenue recognition policy?" } } },
              },
            },
          },
          description: "Grounded answer with exact page and bbox citations, or an explicit abstention. Both retrieval paths return the same fields: `answer`, `reason`, `citations`, `receipt`, `activeWorld`, `freshness`, `answerMode` and `retrievalPath`. `answerMode` is `evidence_excerpts` on both -- the answer is the cited excerpts, concatenated in rank order, and no language model writes any part of it. `retrievalPath` names which runtime answered: `compiled-retrieval-v1` (lexical + dense + structure, RRF-fused, reranked and World Gate filtered; also returns `contextPacket` and `retrieval` diagnostics) or `excerpt-concatenation-fallback` when the active World has no queryable compiled index, which also returns `retrievalIndex` and a human-readable `retrievalNotice`. Per-citation scoring differs by path and is not normalized across them: the fallback carries `relevance` with its lexical/graph/temporal/authority breakdown, the compiled path carries per-source ranks and the reranker score. An abstention is a 200 with `code: ANSWER_ABSTAINED`  a result, not a failure.",
          responses: {
            "200": ok(
              "{ code, answer, reason, citations, receipt, activeWorld, freshness, answerMode, retrievalPath }. `answerMode` is `evidence_excerpts` on both paths. `retrievalPath` is `compiled-retrieval-v1` (which also returns `contextPacket` and `retrieval`) or `excerpt-concatenation-fallback` (which also returns `retrievalIndex` and `retrievalNotice`). An abstention is a 200 with `code` ANSWER_ABSTAINED and a `reason`  a result, not a failure. Read `retrievalPath` before comparing answers across Worlds: a difference between two answers can be a difference between two runtimes rather than between two corpora.",
              { $ref: "#/components/schemas/Answer" },
              {
                code: "GROUNDED_ANSWER",
                answer: "Revenue is recognized when control transfers to the customer.",
                reason: null,
                answerMode: "evidence_excerpts",
                retrievalPath: "compiled-retrieval-v1",
                citations: [{ evidenceId: "ev-01", sourceVersionKey: "src_v_01", page: 4, bbox1000: [118, 214, 886, 374] }],
                activeWorld: { collectionId: "collection-<32 hex>", manifestDigest: "sha256:<64 hex>", revision: 3, activatedAt: "2026-09-16T00:00:00.000Z" },
                freshness: { observedAt: null, processedAt: "2026-09-16T00:00:00.000Z", reviewedAt: null, activatedAt: "2026-09-16T00:00:00.000Z", activeManifestDigest: "sha256:<64 hex>", candidateAwaitingActivation: false, candidateManifestDigest: null },
                receipt: { runId: "ask-<id>", askedAt: "2026-09-16T00:05:00.000Z" },
              },
            ),
            "400": err("QUESTION_INVALID", "RETRIEVAL_QUESTION_INVALID", "COLLECTION_ID_INVALID", "INVALID_JSON"),
            "401": err("AUTH_REQUIRED"),
            "403": err("API_SCOPE_REQUIRED", "PILOT_ACCESS_REQUIRED"),
            "409": err("ACTIVE_WORLD_NOT_FOUND", "ACTIVE_WORLD_CHANGED_RETRY"),
            "413": err("QUESTION_TOO_LARGE"),
            "429": err("API_RATE_LIMITED"),
            "503": err("ACTIVE_WORLD_STORE_UNAVAILABLE", "WORLD_STORE_READ_FAILED"),
          },
        },
      },
      "/runs/{runId}/events": {
        get: {
          operationId: "streamRunEvents",
          summary: "Stream observed run events",
          tags: ["Review"],
          "x-tavonel-scope": "documents:read",
          description: "Replays append-only observed run events after Last-Event-ID, then streams new events and a bounded heartbeat. This is the second of two event streams and the one over *observed* runs  a connector sync, an intake  where /compile-jobs/{jobId}/events follows a compile's own transitions. `after` is the query-parameter form of Last-Event-ID, for clients that cannot set the header.",
          parameters: [
            { name: "runId", in: "path", required: true, schema: { type: "string" } },
            { name: "after", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
            { $ref: "#/components/parameters/LastEventId" },
          ],
          responses: {
            "200": {
              description: "Persisted run-event stream. Frames carry the durable sequence as `id`; a heartbeat frame keeps intermediaries from closing an idle connection.",
              content: {
                "text/event-stream": {
                  schema: { type: "string" },
                  examples: { default: { value: "id: 7\nevent: run\ndata: {\"runId\":\"<run id>\",\"state\":\"running\",\"sequence\":7}\n\n" } },
                },
              },
            },
            "400": err("RUN_ID_REQUIRED", "JOB_CURSOR_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "404": err("JOB_NOT_FOUND", "JOB_SCOPE_INVALID"),
            "503": err("JOB_STORE_READ_FAILED"),
          },
        },
      },
      "/reviews": {
        post: {
          operationId: "recordEvidenceReview",
          summary: "Record a decision over one piece of evidence",
          tags: ["Review"],
          "x-tavonel-auth": "browser-session",
          security: [{ TavonelUserSession: [] }],
          description: "Records an append-only Accept, Edit, or Reject decision after revalidating the evidence against the persisted World. The digest is part of the request because a decision recorded against a version it does not describe is worse than no decision: if the World moved under you, this answers REVIEW_WORLD_CHANGED rather than writing it.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", required: ["collectionId", "manifestDigest", "evidenceId", "action", "reason"], properties: { collectionId: { type: "string", pattern: "^collection-[a-f0-9]{32}$" }, manifestDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, evidenceId: { type: "string" }, action: { enum: ["accept", "edit", "reject"] }, reason: { type: "string", minLength: 8, maxLength: 1000 } }, additionalProperties: false },
                examples: { default: { value: { collectionId: "collection-<32 hex>", manifestDigest: "sha256:<64 hex>", evidenceId: "ev-01", action: "accept", reason: "Checked against page 4 of the filing." } } },
              },
            },
          },
          responses: {
            "201": ok(
              "An evidence-bound human decision receipt. Append-only: a second decision does not overwrite the first.",
              {
                type: "object",
                required: ["code", "receipt"],
                properties: {
                  code: { const: "RECORDED" },
                  receipt: { type: "object", required: ["evidenceId", "action", "recordedAt"], properties: { evidenceId: str, action: str, reason: str, manifestDigest: str, recordedAt: str, actor: nullableStr }, ...bestEffort },
                },
              },
              { code: "RECORDED", receipt: { evidenceId: "ev-01", action: "accept", reason: "Checked against page 4 of the filing.", manifestDigest: "sha256:<64 hex>", recordedAt: "2026-09-16T00:06:00.000Z", actor: "<user id>" } },
            ),
            "400": err("REVIEW_REQUEST_INVALID", "REVIEW_PATCH_INVALID", "PATCH_NO_CHANGE", "INVALID_JSON"),
            "401": err("AUTH_REQUIRED"),
            "404": err("REVIEW_EVIDENCE_NOT_FOUND", "PATCH_TARGET_NOT_FOUND"),
            "409": err("REVIEW_WORLD_CHANGED", "PATCH_BEFORE_MISMATCH", "PATCH_TARGET_NOT_EDITABLE"),
            "413": err("REVIEW_REQUEST_TOO_LARGE"),
            "503": err("REVIEW_STORE_WRITE_FAILED", "REVIEW_STORE_NOT_CONFIGURED"),
          },
        },
      },
      // Kept separate from /ask deliberately: search returns evidence-rich candidates for a
      // caller to reason over, ask returns a grounded answer. A consumer that only needs the
      // facts should not have to pay for generation or parse prose to recover them.
      "/collections/{id}/search": {
        post: {
          operationId: "searchActiveWorld",
          summary: "Search the active World",
          tags: ["Questions"],
          "x-tavonel-scope": "ask:read",
          description: "Retrieval-only search over the active World's compiled retrieval index: hybrid lexical + dense + structure retrieval, RRF-fused, reranked, then World Gate filtered. Returns the ContextPacket (the same runtime contract /ask, MCP and the CLI share) plus per-source retrieval telemetry, without generating an answer. There is no excerpt fallback here -- a World with no queryable compiled index is a 409, not a weaker answer. Read `degradations` before comparing two results: a full-pipeline result and a partial one otherwise look identical.",
          parameters: [{ $ref: "#/components/parameters/CollectionId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", required: ["query"], properties: { query: { type: "string", minLength: 3, maxLength: 500 }, limit: { type: "integer", minimum: 1, maximum: 25, default: 10 } } },
                examples: { default: { value: { query: "revenue recognition policy", limit: 10 } } },
              },
            },
          },
          responses: {
            "200": ok(
              "{ code, retrievalPath, contextPacket, degradations, retrieval, activeWorld, freshness }. The `contextPacket` carries the evidence-bound retrieval units with their lexical, dense and structure ranks, the reranker score and the World Gate decisions; `retrieval` carries the per-source candidate counts and `gateRejections`. `retrievalPath` is always `compiled-retrieval-v1`. `degradations` is a named list of what did not run  dense retrieval skipped with no embedder configured, or the reranker degrading to the fused order  and reading it is how a full-pipeline result is told from a partial one, because the two otherwise look identical.",
              { $ref: "#/components/schemas/SearchResult" },
              {
                code: "SEARCH_RESULTS",
                retrievalPath: "compiled-retrieval-v1",
                contextPacket: { units: [{ evidenceId: "ev-01", sourceVersionKey: "src_v_01", page: 4, bbox1000: [118, 214, 886, 374], text: "Revenue is recognized when control transfers to the customer.", lexicalRank: 1, denseRank: 2, structureRank: null, rerankerScore: 0.82 }] },
                degradations: ["dense retrieval skipped: no embedder configured"],
                retrieval: { lexicalCandidates: 24, denseCandidates: 0, structureCandidates: 6, rerankerApplied: true, gateRejections: [] },
                activeWorld: { collectionId: "collection-<32 hex>", manifestDigest: "sha256:<64 hex>", revision: 3, activatedAt: "2026-09-16T00:00:00.000Z" },
                freshness: { observedAt: null, processedAt: "2026-09-16T00:00:00.000Z", reviewedAt: null, activatedAt: "2026-09-16T00:00:00.000Z", activeManifestDigest: "sha256:<64 hex>", candidateAwaitingActivation: false, candidateManifestDigest: null },
              },
            ),
            "400": err("QUERY_INVALID", "COLLECTION_ID_INVALID", "INVALID_JSON"),
            "401": err("AUTH_REQUIRED"),
            "403": err("API_SCOPE_REQUIRED", "PILOT_ACCESS_REQUIRED"),
            "409": err("RETRIEVAL_RUN_NOT_FOUND", "RETRIEVAL_PROFILE_NOT_FOUND", "ACTIVE_WORLD_NOT_FOUND"),
            "413": err("QUERY_TOO_LARGE"),
            "429": err("API_RATE_LIMITED"),
            "503": err("ACTIVE_WORLD_STORE_UNAVAILABLE"),
          },
        },
      },
      /*
        The World lenses, documented here for the first time -- they shipped before this
        document covered them, which is how a reader ended up with no written bound on a read
        that returned an entire graph.

        Paging is opt-in and stays that way: a default page would truncate every existing
        consumer, including the MCP tools' by-id lookups, into a NOT_FOUND for anything past
        page one. `page.limit: null` in the response is how a client tells a whole-lens answer
        from page one of a paged one.
      */
      "/world/{id}": {
        get: {
          operationId: "getWorldReadModel",
          summary: "Read the whole World",
          tags: ["Worlds"],
          "x-tavonel-scope": "worlds:read",
          description: "The whole World read model: contract, freshness, objects, relations, evidence, directory, ontology, history, files and review state. `manifest` reads a specific version, which is what a two-version diff needs.",
          parameters: [
            { $ref: "#/components/parameters/CollectionId" },
            { name: "manifest", in: "query", required: false, schema: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } },
          ],
          responses: {
            "200": ok(
              "{ code: OK, model }.",
              { type: "object", required: ["code", "model"], properties: { code: { const: "OK" }, model: { $ref: "#/components/schemas/WorldReadModel" } } },
              {
                code: "OK",
                model: {
                  world: { collectionId: "collection-<32 hex>", manifestDigest: "sha256:<64 hex>", revision: 3 },
                  contract: { schemaVersion: "tavonel.world.v1" },
                  freshness: { observedAt: null, processedAt: "2026-09-16T00:00:00.000Z", reviewedAt: null, activatedAt: "2026-09-16T00:00:00.000Z", activeManifestDigest: "sha256:<64 hex>", candidateAwaitingActivation: false, candidateManifestDigest: null },
                  objects: [{ objectId: "obj-01", label: "Revenue recognition policy" }],
                  relations: [], evidence: [], history: [], files: [], review: [],
                },
              },
            ),
            "400": err("WORLD_ID_INVALID", "MANIFEST_DIGEST_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "404": err("WORLD_NOT_FOUND"),
            "422": err("WORLD_READ_MODEL_INVALID"),
            "503": err("WORLD_STORE_READ_FAILED", "WORLD_STORE_NOT_CONFIGURED"),
          },
        },
      },
      "/world/{id}/{lens}": {
        get: {
          operationId: "getWorldLens",
          summary: "Read one lens of a World",
          tags: ["Worlds"],
          "x-tavonel-scope": "worlds:read",
          description: "One lens of the World read model. `objects`, `relations` and `evidence` accept `limit` and `cursor`; `history`, `files` and `review` do not and answer WORLD_LENS_NOT_PAGEABLE if asked. Omitting `limit` returns the whole lens and `page.limit: null`. The cursor is the last item id from the previous page -- keyset, not an offset -- and a cursor naming an id the lens does not contain is a 400 rather than an empty page.",
          parameters: [
            { $ref: "#/components/parameters/CollectionId" },
            { name: "lens", in: "path", required: true, schema: { type: "string", enum: ["objects", "relations", "evidence", "history", "files", "review"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 50 } },
            { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: {
            "200": ok(
              "{ code: OK, world, contract, freshness, <lens>, page }. The lens array is keyed by the lens name, so `objects` comes back under `objects`.",
              {
                type: "object",
                required: ["code", "world", "page"],
                properties: {
                  code: { const: "OK" },
                  world: { $ref: "#/components/schemas/ActiveWorldPointer" },
                  contract: { type: "object", ...bestEffort },
                  freshness: { $ref: "#/components/schemas/Freshness" },
                  page: { $ref: "#/components/schemas/Page" },
                },
                ...bestEffort,
              },
              {
                code: "OK",
                world: { collectionId: "collection-<32 hex>", manifestDigest: "sha256:<64 hex>", revision: 3, activatedAt: "2026-09-16T00:00:00.000Z" },
                evidence: [{ evidenceId: "ev-01", sourceVersionKey: "src_v_01", page: 4, bbox1000: [118, 214, 886, 374] }],
                page: { limit: 50, cursor: null, nextCursor: "ev-50", total: 212 },
              },
            ),
            "400": err("WORLD_ID_INVALID", "WORLD_LENS_NOT_PAGEABLE", "WORLD_PAGE_LIMIT_INVALID", "WORLD_PAGE_CURSOR_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "404": err("WORLD_NOT_FOUND", "WORLD_LENS_NOT_FOUND"),
            "503": err("WORLD_STORE_READ_FAILED"),
          },
        },
      },
      /*
        Staleness, answerable online. Rollback restores a prior revision; it does not undo
        downstream use of an older answer, and a signed package already downloaded verifies
        offline and cannot be recalled remotely. This does not change either fact -- it lets a
        holder check, live, whether the copy they hold is still the current one.
      */
      "/world/{id}/manifest-status": {
        get: {
          operationId: "getManifestStatus",
          summary: "Check whether a held version is still current",
          tags: ["Worlds"],
          "x-tavonel-scope": "worlds:read",
          description: "Whether a manifest digest is the one this workspace currently answers from. `active: false` means a different version is active now; it does not mean the held copy was withdrawn or deleted, and this endpoint deletes nothing. `knownToWorkspace: false` means this workspace has no record of ever activating that digest, which is a different answer from 'it was superseded'.",
          parameters: [
            { $ref: "#/components/parameters/CollectionId" },
            { name: "digest", in: "query", required: true, schema: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } },
          ],
          responses: {
            "200": ok(
              "The status of that digest against the workspace's current state.",
              {
                type: "object",
                required: ["code", "manifestStatus"],
                properties: {
                  code: { const: "MANIFEST_STATUS" },
                  manifestStatus: {
                    type: "object",
                    required: ["collectionId", "manifestDigest", "active", "knownToWorkspace"],
                    properties: {
                      collectionId: str, manifestDigest: str,
                      active: { type: "boolean" },
                      activeManifestDigest: nullableStr,
                      knownToWorkspace: { type: "boolean" },
                      lifecycleStatus: nullableStr,
                      activatedAt: nullableStr,
                    },
                  },
                },
              },
              {
                code: "MANIFEST_STATUS",
                manifestStatus: { collectionId: "collection-<32 hex>", manifestDigest: "sha256:<64 hex>", active: false, activeManifestDigest: "sha256:<64 hex>", knownToWorkspace: true, lifecycleStatus: "superseded", activatedAt: "2026-09-10T00:00:00.000Z" },
              },
            ),
            "400": err("WORLD_ID_INVALID", "MANIFEST_DIGEST_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "409": err("ACTIVE_WORLD_NOT_FOUND"),
            "503": err("WORLD_STORE_READ_FAILED"),
          },
        },
      },
      "/connections": {
        get: {
          operationId: "listConnections",
          summary: "List source connections",
          tags: ["Connections"],
          "x-tavonel-scope": "connections:read",
          description: "Tenant-scoped durable source connections and their committed cursor state. Takes no paging parameters. The cursor is opaque: it is a sha256 over the collector's own position, and the only supported way to advance it is to send a batch whose `previousCursorSha256` matches the committed one.",
          responses: {
            "200": ok(
              "The workspace's connections, with the committed cursor on each.",
              { type: "object", required: ["connections"], properties: { connections: { type: "array", items: { $ref: "#/components/schemas/Connection" } } }, ...bestEffort },
              {
                connections: [{
                  connectionId: "00000000-0000-4000-8000-000000000000",
                  provider: "s3", mode: "local_agent", displayName: "Contracts bucket",
                  status: "active", cursorSha256: "sha256:<64 hex>",
                  lastSyncAt: "2026-09-16T00:00:00.000Z", lastErrorCode: null,
                  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
                }],
              },
            ),
            "401": err("AUTH_REQUIRED"),
            "403": err("API_SCOPE_REQUIRED", "PILOT_ACCESS_REQUIRED"),
            "503": err("DEVELOPER_STORE_READ_FAILED", "DEVELOPER_STORE_NOT_CONFIGURED", "DEVELOPER_STORE_BINDING_INVALID"),
          },
        },
        post: {
          operationId: "createConnection",
          summary: "Create a source connection",
          tags: ["Connections"],
          "x-tavonel-scope": "connections:write",
          description: "Registers a local-agent file-server, S3, R2 or MinIO source. Credentials stay in the customer environment: `secretReference` must be null, because a local agent uses its own workload credentials and TAVONEL never holds them. The agent pushes outward; nothing here reaches into your network.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ConnectionInput" },
                examples: { default: { value: { provider: "s3", mode: "local_agent", displayName: "Contracts bucket", configuration: { bucket: "contracts", prefix: "2026/", region: "ap-northeast-2" }, secretReference: null } } },
              },
            },
          },
          responses: {
            "201": ok(
              "The durable connection record, with an empty cursor.",
              { $ref: "#/components/schemas/Connection" },
              {
                connectionId: "00000000-0000-4000-8000-000000000000",
                provider: "s3", mode: "local_agent", displayName: "Contracts bucket",
                status: "active", cursorSha256: null, lastSyncAt: null, lastErrorCode: null,
                createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
              },
            ),
            "400": err("CONNECTION_INPUT_INVALID", "INVALID_JSON"),
            "401": err("AUTH_REQUIRED"),
            "403": err("API_SCOPE_REQUIRED", "PILOT_ACCESS_REQUIRED"),
            "413": err("REQUEST_TOO_LARGE"),
            "503": err("CONNECTION_CREATE_FAILED", "DEVELOPER_STORE_NOT_CONFIGURED"),
          },
        },
      },
      "/connections/{id}": {
        delete: {
          operationId: "revokeConnection",
          summary: "Revoke a source connection",
          tags: ["Connections"],
          "x-tavonel-scope": "connections:write",
          parameters: [{ $ref: "#/components/parameters/ConnectionId" }],
          description: "Revokes the connection. Access removal takes effect on the next request rather than waiting for a background reindex. Immutable outputs already compiled are retained: a revoke stops future reads, it does not rewrite history.",
          responses: {
            "204": { description: "Connection revoked; immutable outputs retained. No body." },
            "400": err("CONNECTION_ID_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "404": err("CONNECTION_NOT_FOUND"),
            "503": err("CONNECTION_REVOKE_FAILED"),
          },
        },
      },
      "/connections/{id}/sync": {
        post: {
          operationId: "applyConnectionBatch",
          summary: "Advance a connection cursor or report a complete inventory scan",
          tags: ["Connections"],
          "x-tavonel-scope": "connections:sync",
          parameters: [{ $ref: "#/components/parameters/ConnectionId" }],
          description: "Applies one batch of source events and advances the cursor. `previousCursorSha256` must match the committed cursor, so two collectors cannot both advance it; a mismatch is a 409 and nothing is applied. Replaying an identical `batchId` is idempotent  delivery is at-least-once and this is the consumer that makes it exactly-once.\n\nA body with an `operation` field is instead one step of a complete inventory scan: `inventory.begin` (compare-and-set on `expectedHeadEpoch`; `scanEpoch` must exceed every open scan's, and a newer one supersedes it), `inventory.page` (an identical page is an idempotent replay), `inventory.finalize` (requires `complete: true` and every declared page). An item missing from a finalized scan is marked unobserved  a deletion candidate, never a deletion  and `aclObservationSha256` is recorded as an observation that grants no access. An open scan expires six hours after begin.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { oneOf: [{ $ref: "#/components/schemas/ConnectionBatch" }, { $ref: "#/components/schemas/ConnectionInventoryRequest" }] },
                examples: {
                  default: {
                    value: {
                      batchId: "00000000-0000-4000-8000-000000000000",
                      previousCursorSha256: null,
                      nextCursorSha256: "sha256:<64 hex>",
                      manifestSha256: "sha256:<64 hex>",
                      events: [{ kind: "added", nativeId: "s3://contracts/2026/a.pdf", revision: "\"etag\"", contentSha256: "<64 hex>", sizeBytes: 184320, mimeType: "application/pdf", documentId: "00000000-0000-4000-8000-000000000001", sourceIdempotencyKey: "<64 hex>" }],
                    },
                  },
                  inventoryBegin: {
                    value: { operation: "inventory.begin", scanId: "00000000-0000-4000-8000-000000000002", scanEpoch: 1, expectedHeadEpoch: 0, itemCount: 1, pageCount: 1 },
                  },
                  inventoryPage: {
                    value: { operation: "inventory.page", scanId: "00000000-0000-4000-8000-000000000002", pageIndex: 0, items: [{ nativeId: "contracts/2026/a.pdf", revision: "mtime:1790000000", contentSha256: "<64 hex>", sizeBytes: 184320, mimeType: "application/pdf", aclObservationSha256: null }] },
                  },
                  inventoryFinalize: {
                    value: { operation: "inventory.finalize", scanId: "00000000-0000-4000-8000-000000000002", complete: true, itemCount: 1, pageCount: 1 },
                  },
                },
              },
            },
          },
          responses: {
            "200": ok(
              "The cursor transition, applied or idempotently replayed. `status: replayed` means this exact batch had already been applied and nothing changed. An inventory step answers `status` begun, staged, finalized or replayed with its own fields (`scanId`, `scanEpoch`, `headEpoch`, `pageIndex`, `itemCount`, or the finalize `receipt`).",
              {
                type: "object",
                required: ["code", "status"],
                properties: { code: { const: "OK" }, status: { enum: ["applied", "replayed", "begun", "staged", "finalized"] }, batchId: str, cursorSha256: nullableStr, eventCount: int, scanId: str, scanEpoch: int, headEpoch: int, pageIndex: int, itemCount: int, receipt: { type: "object" } },
                ...bestEffort,
              },
              { code: "OK", status: "applied", batchId: "00000000-0000-4000-8000-000000000000", cursorSha256: "sha256:<64 hex>", eventCount: 1 },
            ),
            "400": err("CONNECTION_BATCH_INVALID", "CONNECTION_ID_INVALID", "SOURCE_IDENTITY_INVALID", "SOURCE_DIGEST_REQUIRED", "SOURCE_METADATA_INVALID", "INVALID_JSON",
              "INVENTORY_CONTRACT_INVALID", "INVENTORY_ITEM_INVALID", "INVENTORY_PAGE_INDEX_INVALID", "INVENTORY_NOT_ATTESTED_COMPLETE"),
            "401": err("AUTH_REQUIRED"),
            "403": err("CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", "INVENTORY_ACTOR_INVALID"),
            "404": err("CONNECTION_NOT_FOUND"),
            "409": err("CONNECTION_BATCH_CONFLICT", "CONNECTION_CURSOR_CONFLICT", "SOURCE_CURSOR_STALE", "SOURCE_DIGEST_CONFLICT", "SOURCE_DIGEST_MISMATCH", "SOURCE_VERSION_DIGEST_CONFLICT",
              "INVENTORY_HEAD_STALE", "INVENTORY_EPOCH_STALE", "INVENTORY_SCAN_CONFLICT", "INVENTORY_SCAN_NOT_FOUND", "INVENTORY_SCAN_NOT_OPEN", "INVENTORY_SCAN_EXPIRED",
              "INVENTORY_PAGE_CONFLICT", "INVENTORY_COUNT_MISMATCH", "INVENTORY_PAGES_INCOMPLETE", "INVENTORY_DUPLICATE_ITEM", "INVENTORY_FINALIZE_CONFLICT"),
            "413": err("REQUEST_TOO_LARGE", "SOURCE_CURSOR_TOO_LARGE", "INVENTORY_LIMIT_EXCEEDED"),
            "423": err("CONNECTION_NOT_SYNCABLE", "SOURCE_LIFECYCLE_REVIEW_REQUIRED"),
            "503": err("CONNECTION_BATCH_FAILED", "INVENTORY_UNAVAILABLE"),
          },
        },
      },
      "/oauth-connectors": {
        get: {
          operationId: "listOAuthConnectors",
          summary: "List OAuth connector state",
          tags: ["Connections"],
          "x-tavonel-auth": "browser-session",
          security: [{ TavonelUserSession: [] }],
          description: "Lists configured provider readiness and tenant OAuth connections. Provider credentials are never returned. A provider whose client is not configured reports `configured: false` rather than being hidden.",
          responses: {
            "200": ok(
              "Provider readiness and the workspace's connections.",
              {
                type: "object",
                required: ["code", "providers", "connections"],
                properties: {
                  code: { const: "OK" },
                  providers: { type: "array", items: { type: "object", required: ["provider", "configured"], properties: { provider: str, configured: { type: "boolean" } }, ...bestEffort } },
                  connections: { type: "array", items: { type: "object", ...bestEffort } },
                },
              },
              {
                code: "OK",
                providers: [{ provider: "google_drive", configured: false }, { provider: "dropbox", configured: false }, { provider: "microsoft_graph", configured: false }],
                connections: [],
              },
            ),
            "401": err("AUTH_REQUIRED"),
            "503": err("OAUTH_STORE_UNAVAILABLE", "OAUTH_STORE_NOT_CONFIGURED"),
          },
        },
      },
      "/oauth-connectors/authorize": {
        post: {
          operationId: "startOAuthConnectorAuthorization",
          summary: "Start an OAuth authorization",
          tags: ["Connections"],
          "x-tavonel-auth": "browser-session",
          security: [{ TavonelUserSession: [] }],
          description: "Creates a single-use PKCE authorization. Fails closed unless the provider client and the managed secret broker are both configured  an authorization that cannot store a refresh secret is not started.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OAuthConnectorAuthorizationInput" },
                examples: { default: { value: { provider: "google_drive", displayName: "Finance shared drive" } } },
              },
            },
          },
          responses: {
            "200": ok(
              "A short-lived provider authorization URL. Single-use: a second visit to it is refused.",
              { type: "object", required: ["code", "authorizationUrl", "expiresAt"], properties: { code: { const: "AUTHORIZED_REDIRECT_READY" }, authorizationUrl: { type: "string", format: "uri" }, expiresAt: str, state: str }, ...bestEffort },
              { code: "AUTHORIZED_REDIRECT_READY", authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?...", expiresAt: "2026-09-16T00:10:00.000Z" },
            ),
            "400": err("OAUTH_CONNECTOR_INPUT_INVALID", "INVALID_JSON"),
            "401": err("AUTH_REQUIRED"),
            "413": err("REQUEST_TOO_LARGE"),
            "503": err("OAUTH_PROVIDER_NOT_CONFIGURED", "OAUTH_SECRET_BROKER_NOT_CONFIGURED", "OAUTH_AUTHORIZATION_START_FAILED"),
          },
        },
      },
      "/oauth-connectors/connections/{id}": {
        delete: {
          operationId: "revokeOAuthConnector",
          summary: "Revoke an OAuth connection",
          tags: ["Connections"],
          "x-tavonel-auth": "browser-session",
          security: [{ TavonelUserSession: [] }],
          parameters: [{ $ref: "#/components/parameters/OAuthConnectionId" }],
          description: "Deletes the stored refresh secret and revokes the connection. Reported as done only when the secret is actually gone  a revoke that cannot be proven answers 503 rather than 204.",
          responses: {
            "204": { description: "Refresh secret deleted and connection revoked. No body." },
            "400": err("OAUTH_CONNECTION_ID_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "404": err("OAUTH_CONNECTION_NOT_FOUND"),
            "503": err("OAUTH_SECRET_REVOCATION_FAILED", "OAUTH_SECRET_BROKER_NOT_CONFIGURED"),
          },
        },
      },
      "/developer/keys/{id}/rotate": {
        post: {
          operationId: "rotateDeveloperApiKey",
          summary: "Rotate an API key",
          tags: ["Workspace administration"],
          "x-tavonel-auth": "browser-session",
          security: [{ TavonelUserSession: [] }],
          description: "Atomically creates a replacement key, revokes the source key and writes an audit event. Plaintext is returned once and is not recoverable afterwards. Either all three happened or none did  there is no state where the old key is revoked and no replacement exists.",
          parameters: [{ $ref: "#/components/parameters/DeveloperKeyId" }],
          responses: {
            "201": ok(
              "The one-time replacement credential. Store it now; it is not shown again.",
              {
                type: "object",
                required: ["code", "keyId", "plaintext"],
                properties: { code: { const: "ROTATED" }, keyId: { type: "string", format: "uuid" }, plaintext: { type: "string", description: "Shown once." }, scopes: { type: "array", items: str }, revokedKeyId: str, createdAt: str },
                ...bestEffort,
              },
              { code: "ROTATED", keyId: "00000000-0000-4000-8000-000000000002", plaintext: "tvnl_live_<prefix>_<secret>", scopes: ["documents:read", "worlds:read"], revokedKeyId: "00000000-0000-4000-8000-000000000001", createdAt: "2026-09-16T00:07:00.000Z" },
            ),
            "400": err("API_KEY_ID_INVALID", "API_KEY_INPUT_INVALID", "INVALID_JSON"),
            "401": err("AUTH_REQUIRED"),
            "402": err("TRIAL_FEATURE_NOT_INCLUDED"),
            "404": err("API_KEY_NOT_FOUND"),
            "413": err("REQUEST_TOO_LARGE"),
            "503": err("API_KEY_ROTATE_FAILED", "API_KEY_CREATE_FAILED", "DEVELOPER_AUDIT_WRITE_FAILED"),
          },
        },
      },
      "/developer/audit": {
        get: {
          operationId: "listDeveloperAuditEvents",
          summary: "Read the developer audit trail",
          tags: ["Workspace administration"],
          "x-tavonel-auth": "browser-session",
          security: [{ TavonelUserSession: [] }],
          description: "The tenant-scoped developer and connector audit trail, newest first, bounded by `limit`. Every key create, rotate and revoke writes a row here or does not happen.",
          parameters: [{ name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } }],
          responses: {
            "200": ok(
              "{ code: OK, events }, newest first.",
              {
                type: "object",
                required: ["code", "events"],
                properties: {
                  code: { const: "OK" },
                  events: { type: "array", items: { type: "object", required: ["eventType", "occurredAt"], properties: { eventType: str, occurredAt: str, actor: nullableStr, subject: nullableStr, detail: { type: "object", ...bestEffort } }, ...bestEffort } },
                },
              },
              { code: "OK", events: [{ eventType: "developer_key_rotated", occurredAt: "2026-09-16T00:07:00.000Z", actor: "<user id>", subject: "00000000-0000-4000-8000-000000000001", detail: {} }] },
            ),
            "400": err("AUDIT_LIMIT_INVALID"),
            "401": err("AUTH_REQUIRED"),
            "503": err("DEVELOPER_AUDIT_READ_FAILED", "DEVELOPER_STORE_NOT_CONFIGURED"),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        TavonelApiKey: { type: "http", scheme: "bearer", bearerFormat: "tvnl_live_<prefix>_<secret>", description: "Create in Workspace > Developers. The plaintext is shown once." },
        TavonelUserSession: { type: "http", scheme: "bearer", bearerFormat: "Supabase access JWT", description: "Interactive user session. Developer API keys cannot call management or OAuth routes." },
      },
      parameters: {
        CollectionId: { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^collection-[a-f0-9]{32}$" } },
        CompileJobId: { name: "jobId", in: "path", required: true, schema: { type: "string", pattern: "^cjob-[a-f0-9]{32}$" } },
        ConnectionId: { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        OAuthConnectionId: { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        DeveloperKeyId: { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        LastEventId: { name: "Last-Event-ID", in: "header", required: false, schema: { type: "string" }, description: "The durable sequence to resume after. Set automatically by EventSource on reconnect." },
        SourceIdempotencyKey: { name: "x-tavonel-source-idempotency-key", in: "header", required: false, schema: { type: "string", pattern: "^[a-f0-9]{64}$" }, description: "Tenant-bound source-event key. Makes the document id deterministic so a retried intake converges on one document." },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["code"],
          description: "Every failure carries a stable machine code. Branch on the code, not the status: the status says what kind of problem it is and the code says which one. The full catalogue, with what to do about each code, is in `x-tavonel-error-catalogue` and rendered at /docs/errors.",
          properties: { code: { type: "string", enum: API_ERROR_CODES.map((entry) => entry.code) } },
          additionalProperties: true,
        },
        Page: {
          type: "object",
          description: "Keyset paging. `cursor` is the last item id from the previous page, never an offset. `limit: null` means the whole collection was returned.",
          properties: { limit: { type: ["integer", "null"] }, cursor: nullableStr, nextCursor: nullableStr, total: { type: ["integer", "null"] } },
        },
        Freshness: {
          type: "object",
          description: "Six clocks, each saying what it is and when it is null. A null is never a substitute drawn from one of the others.",
          properties: {
            observedAt: { ...nullableStr, description: "When the source bytes were first observed." },
            processedAt: { ...nullableStr, description: "When the compile job reached a terminal state." },
            reviewedAt: { ...nullableStr, description: "When a person answered a compile blocker. Null when a compile had no blockers." },
            activatedAt: { ...nullableStr, description: "When a person made this version the active World." },
            activeManifestDigest: { ...nullableStr, description: "The version this answer came from." },
            candidateAwaitingActivation: { type: ["boolean", "null"] },
            candidateManifestDigest: nullableStr,
          },
        },
        ActiveWorldPointer: {
          type: "object",
          required: ["collectionId", "manifestDigest"],
          properties: { collectionId: str, manifestDigest: str, revision: int, activatedAt: nullableStr },
        },
        IntakeManifestEntry: {
          type: "object", required: ["fileKey", "originalFilename", "contentSha256", "byteLength", "mimeType", "claimedPages", "claimedBasis"], additionalProperties: false,
          properties: { fileKey: { type: "string", minLength: 8, maxLength: 128 }, originalFilename: { type: "string", minLength: 1, maxLength: 255 }, contentSha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, byteLength: { type: "integer", minimum: 1 }, mimeType: str, claimedPages: { type: ["integer", "null"], minimum: 1 }, claimedBasis: { type: ["string", "null"], enum: ["pdf_page_tree", "image", "pptx_slides", "docx_declared", null] } },
        },
        UploadQuoteTotals: {
          type: "object", required: ["maximumPages", "reservedCredits", "maximumCredits", "estimatedUsd", "maximumUsd"], properties: { maximumPages: int, reservedCredits: int, maximumCredits: int, estimatedUsd: { type: "number" }, maximumUsd: { type: "number" } },
        },
        IntakeQuote: {
          type: "object", required: ["code", "clientManifestDigest", "pricingFingerprint", "metadataLimitBytes", "quote", "files"], properties: { code: { const: "INTAKE_QUOTE" }, clientManifestDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, pricingFingerprint: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, metadataLimitBytes: int, quote: { $ref: "#/components/schemas/UploadQuoteTotals" }, files: { type: "array", items: { type: "object", required: ["fileKey", "pageBasis", "approvedMaxPages", "reservedCredits", "maximumCredits"], properties: { fileKey: str, pageBasis: { type: "string", enum: ["unknown", "declared", "pdf_page_tree", "image", "pptx_slides", "docx_declared"] }, approvedMaxPages: int, reservedCredits: int, maximumCredits: int } } }, ...bestEffort },
        },
        UploadApprovalFile: {
          type: "object", required: ["fileKey", "documentId", "fileState"], properties: { fileKey: str, documentId: { type: "string", format: "uuid" }, fileState: { type: "string", enum: ["approved", "reserved", "confirmed", "cancelled"] }, contentSha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, byteLength: int, mimeType: str, approvedMaximumCredits: int },
        },
        UploadApproval: {
          type: "object", required: ["approvalId", "attemptKey", "clientManifestDigest", "scopeDigest", "pricingFingerprint", "state", "files"], properties: { approvalId: { type: "string", format: "uuid" }, attemptKey: str, clientManifestDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, scopeDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, pricingFingerprint: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, state: str, aggregateMaximumCredits: int, files: { type: "array", items: { $ref: "#/components/schemas/UploadApprovalFile" } }, ...bestEffort },
        },
        CapabilityManifest: {
          type: "object",
          required: ["schemaVersion", "defaultStatus", "entries", "contentSha256"],
          properties: {
            schemaVersion: str,
            generatedFrom: str,
            defaultStatus: { const: "UNSUPPORTED" },
            contentSha256: str,
            entries: {
              type: "array",
              items: {
                type: "object",
                required: ["sourceFamily", "mime", "extensions", "status", "preserved", "knownLimitations", "qualifiedAt", "qualificationReceipt"],
                properties: {
                  sourceFamily: str, mime: str,
                  extensions: { type: "array", items: str },
                  status: str,
                  readerPlan: { type: "array", items: str },
                  preserved: { type: "array", items: str },
                  visual: { type: "array", items: str },
                  knownLimitations: { type: "array", items: str, description: "Tokens, not prose. The two per-source ceilings TAVONEL enforces appear here." },
                  evidenceLocatorKinds: { type: "array", items: str },
                  qualifiedAt: { ...nullableStr, description: "Null everywhere until a qualification run produces a receipt. A verified tier without a receipt is not representable." },
                  qualificationReceipt: nullableStr,
                },
              },
            },
          },
        },
        Document: {
          type: "object",
          required: ["documentId"],
          properties: {
            documentId: { type: "string", format: "uuid" },
            originalFilename: str, mimeType: str,
            state: { ...str, description: "Processing state. A document refused at read carries its refusal rather than being omitted." },
            sourceVersionKey: nullableStr,
            createdAt: str,
          },
          ...bestEffort,
        },
        CandidateReceipt: {
          type: "object",
          required: ["code", "collectionId", "manifestDigest", "candidatePromotion"],
          properties: {
            code: { const: "COLLECTION_CANDIDATE_READY" },
            collectionId: str, manifestDigest: str,
            candidatePromotion: { const: false, description: "Always false. Activation is a human decision in a signed-in session; no key holds it." },
            documentsTotal: int,
          },
          ...bestEffort,
        },
        CompileJob: {
          type: "object",
          required: ["jobId", "state", "documentIds", "documentsTotal", "documentsReady", "blocked", "createdAt", "updatedAt"],
          properties: {
            jobId: str,
            state: str,
            collectionId: nullableStr,
            errorCode: nullableStr,
            documentIds: { type: "array", items: str },
            documentsTotal: int, documentsReady: int,
            blocked: { type: "array", items: { type: "object", ...bestEffort }, description: "Blocked documents. A job holding any of these stops and waits; nothing skips them by itself." },
            blockedResolution: { type: ["string", "null"], enum: ["continue", "remove_blocked", "retry_eligible", null] },
            corpusId: { ...nullableStr, description: "Set only on a part of a partitioned run; null on an ordinary compile." },
            batchIndex: { type: ["integer", "null"] },
            batchCount: { type: ["integer", "null"] },
            createdAt: str, updatedAt: str, settledAt: nullableStr,
          },
        },
        CompileJobAccepted: {
          type: "object",
          required: ["code", "jobId", "state", "documentsTotal"],
          properties: { code: { const: "COMPILE_JOB_ACCEPTED" }, jobId: str, state: str, documentsTotal: int },
        },
        CompileCorpusAccepted: {
          type: "object",
          required: ["code", "corpusId", "batchCount", "parts"],
          properties: { code: { const: "COMPILE_CORPUS_ACCEPTED" }, corpusId: str, batchCount: int, parts: { type: "array", items: { type: "object", ...bestEffort } } },
        },
        CompileCorpus: {
          type: "object",
          required: ["code", "corpusId", "state", "parts"],
          properties: {
            code: { const: "OK" },
            corpusId: str,
            state: { ...str, description: "`partial` means some parts compiled and at least one did not. Computed from the part rows every time; there is no stored roll-up." },
            documentsTotal: int, documentsReady: int, partsEnqueued: int, batchCount: { type: ["integer", "null"] },
            incompleteReason: nullableStr,
            parts: { type: "array", items: { type: "object", ...bestEffort } },
          },
        },
        RetrievalIndexState: {
          type: "object",
          required: ["status"],
          properties: {
            status: { enum: ["missing", "compiled", "failed"], description: "An index that exists but has not finished is `missing`: half an index is not a smaller index." },
            errorClass: nullableStr, runId: nullableStr, retrievalProfileId: nullableStr,
          },
        },
        Answer: {
          type: "object",
          required: ["code", "answer", "citations", "answerMode", "retrievalPath"],
          properties: {
            code: { enum: ["GROUNDED_ANSWER", "ANSWER_ABSTAINED"] },
            answer: nullableStr,
            reason: { ...nullableStr, description: "Set on an abstention. An abstention is a result, not a failure." },
            answerMode: { const: "evidence_excerpts", description: "The answer is the cited excerpts concatenated in rank order. No language model writes any part of it. The day one does, this field will say a different word." },
            retrievalPath: { enum: ["compiled-retrieval-v1", "excerpt-concatenation-fallback"] },
            citations: { type: "array", items: { $ref: "#/components/schemas/Citation" } },
            contextPacket: { type: "object", description: "Compiled path only.", ...bestEffort },
            retrieval: { type: "object", description: "Compiled path only.", ...bestEffort },
            retrievalIndex: { $ref: "#/components/schemas/RetrievalIndexState" },
            retrievalNotice: nullableStr,
            activeWorld: { $ref: "#/components/schemas/ActiveWorldPointer" },
            freshness: { $ref: "#/components/schemas/Freshness" },
            receipt: { type: "object", ...bestEffort },
          },
          ...bestEffort,
        },
        Citation: {
          type: "object",
          required: ["evidenceId", "sourceVersionKey", "page"],
          properties: {
            evidenceId: str, sourceVersionKey: str,
            page: int,
            bbox1000: { type: "array", items: int, minItems: 4, maxItems: 4, description: "The region in a 0-1000 page frame, so it is resolution-independent." },
            relevance: { type: "object", description: "Fallback path only. Not normalized against the compiled path's ranks  presenting one as the other would mean inventing a number neither path measured.", ...bestEffort },
          },
          ...bestEffort,
        },
        SearchResult: {
          type: "object",
          required: ["code", "retrievalPath", "contextPacket", "degradations"],
          properties: {
            code: { enum: ["SEARCH_RESULTS", "SEARCH_EMPTY"] },
            retrievalPath: { const: "compiled-retrieval-v1", description: "Always this. Search has no excerpt fallback." },
            contextPacket: { type: "object", description: "Evidence-bound retrieval units with their per-source ranks and reranker score.", ...bestEffort },
            degradations: { type: "array", items: str, description: "A named list of what did not run. Empty means every source ran. A degradation is reported, never hidden  the two otherwise look identical." },
            retrieval: { type: "object", ...bestEffort },
            activeWorld: { $ref: "#/components/schemas/ActiveWorldPointer" },
            freshness: { $ref: "#/components/schemas/Freshness" },
          },
          ...bestEffort,
        },
        WorldReadModel: {
          type: "object",
          description: "The whole read model. Every lens is present; the lens routes serve one of them at a time.",
          properties: {
            world: { $ref: "#/components/schemas/ActiveWorldPointer" },
            contract: { type: "object", ...bestEffort },
            freshness: { $ref: "#/components/schemas/Freshness" },
            objects: { type: "array", items: { type: "object", ...bestEffort } },
            relations: { type: "array", items: { type: "object", ...bestEffort } },
            evidence: { type: "array", items: { $ref: "#/components/schemas/Citation" } },
            history: { type: "array", items: { type: "object", ...bestEffort } },
            files: { type: "array", items: { type: "object", ...bestEffort } },
            review: { type: "array", items: { type: "object", ...bestEffort } },
          },
          ...bestEffort,
        },
        Connection: {
          type: "object",
          required: ["connectionId", "provider", "mode", "displayName", "status"],
          properties: {
            connectionId: { type: "string", format: "uuid" },
            provider: { enum: ["file_server", "s3", "r2", "minio"] },
            mode: { const: "local_agent" },
            displayName: str,
            status: str,
            cursorSha256: { ...nullableStr, description: "The committed cursor. Opaque: the only supported way to move it is a batch whose `previousCursorSha256` matches it." },
            lastSyncAt: nullableStr,
            lastErrorCode: nullableStr,
            createdAt: str, updatedAt: str,
          },
          ...bestEffort,
        },
        ConnectionInput: {
          type: "object",
          required: ["provider", "mode", "displayName", "configuration"],
          properties: {
            provider: { enum: ["file_server", "s3", "r2", "minio"] },
            mode: { const: "local_agent" },
            displayName: { type: "string", minLength: 1, maxLength: 100 },
            configuration: {
              type: "object",
              description: "Non-secret source selectors such as bucket, prefix, region or rootLabel.",
              additionalProperties: true,
            },
            secretReference: { type: "null", description: "Local agents use workload credentials; secrets are never sent to TAVONEL." },
          },
          additionalProperties: false,
        },
        OAuthConnectorAuthorizationInput: {
          type: "object",
          required: ["provider", "displayName"],
          properties: {
            provider: { enum: ["google_drive", "dropbox", "microsoft_graph"] },
            displayName: { type: "string", minLength: 1, maxLength: 100 },
          },
          additionalProperties: false,
        },
        ConnectionEvent: {
          type: "object",
          required: ["kind", "nativeId", "revision", "contentSha256", "sizeBytes", "mimeType", "documentId", "sourceIdempotencyKey"],
          description: "One observed change at the source. Every field is required and several are explicitly nullable: a collector that cannot compute a digest sends null rather than omitting the field, so 'not known' and 'not sent' are different states.",
          properties: {
            kind: { enum: ["added", "changed", "deleted"] },
            nativeId: { type: "string", maxLength: 1024, description: "The source's own identifier, stable across revisions." },
            revision: { type: "string", maxLength: 512, description: "The source's own version marker  an ETag, an mtime, a version id." },
            contentSha256: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" },
            sizeBytes: { type: ["integer", "null"], minimum: 0, maximum: 524288000 },
            mimeType: { type: ["string", "null"] },
            documentId: { type: ["string", "null"], format: "uuid", description: "Immutable intake document created by a direct upload, when this source type is qualified." },
            sourceIdempotencyKey: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$", description: "Tenant-bound source-event key; required with documentId and revalidated by the server." },
          },
          additionalProperties: false,
        },
        ConnectionBatch: {
          type: "object",
          required: ["batchId", "previousCursorSha256", "nextCursorSha256", "manifestSha256", "events"],
          description: "One cursor transition. `previousCursorSha256` is the optimistic lock: it must match the committed cursor or nothing is applied. Replaying an identical `batchId` is idempotent.",
          properties: {
            batchId: { type: "string", format: "uuid" },
            previousCursorSha256: { type: ["string", "null"], pattern: "^sha256:[a-f0-9]{64}$" },
            nextCursorSha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
            manifestSha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
            events: { type: "array", maxItems: 5000, items: { $ref: "#/components/schemas/ConnectionEvent" } },
          },
          additionalProperties: false,
        },
        ConnectionInventoryItem: {
          type: "object",
          required: ["nativeId", "revision", "contentSha256", "sizeBytes", "mimeType", "aclObservationSha256"],
          properties: {
            nativeId: { type: "string", minLength: 1, description: "1-1024 UTF-8 bytes, no C0 control or DEL." },
            revision: { type: "string", minLength: 1, description: "1-512 UTF-8 bytes, no C0 control or DEL." },
            contentSha256: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" },
            sizeBytes: { type: "integer", minimum: 0, maximum: 1099511627776 },
            mimeType: { type: ["string", "null"], pattern: "^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$", maxLength: 127 },
            aclObservationSha256: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$", description: "An opaque digest of the permissions the agent observed. Recorded, never enforced as access." },
          },
          additionalProperties: false,
        },
        ConnectionInventoryRequest: {
          description: "One step of a complete inventory scan. The workspace is always the caller's; the body cannot name one.",
          oneOf: [
            {
              type: "object",
              required: ["operation", "scanId", "scanEpoch", "expectedHeadEpoch", "itemCount", "pageCount"],
              properties: { operation: { const: "inventory.begin" }, scanId: { type: "string", format: "uuid" }, scanEpoch: { type: "integer", minimum: 1 }, expectedHeadEpoch: { type: "integer", minimum: 0 }, itemCount: { type: "integer", minimum: 0, maximum: 100000 }, pageCount: { type: "integer", minimum: 1, maximum: 400 } },
              additionalProperties: false,
            },
            {
              type: "object",
              required: ["operation", "scanId", "pageIndex", "items"],
              properties: { operation: { const: "inventory.page" }, scanId: { type: "string", format: "uuid" }, pageIndex: { type: "integer", minimum: 0, maximum: 399 }, items: { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/ConnectionInventoryItem" } } },
              additionalProperties: false,
            },
            {
              type: "object",
              required: ["operation", "scanId", "complete", "itemCount", "pageCount"],
              properties: { operation: { const: "inventory.finalize" }, scanId: { type: "string", format: "uuid" }, complete: { const: true }, itemCount: { type: "integer", minimum: 0, maximum: 100000 }, pageCount: { type: "integer", minimum: 1, maximum: 400 } },
              additionalProperties: false,
            },
          ],
        },
      },
    },
    "x-tavonel-scopes": DEVELOPER_SCOPES,
    "x-tavonel-api-version": 1,
    "x-tavonel-version-policy": {
      pathMajor: "/api/v1",
      responseHeader: "X-TAVONEL-API-Version",
      clientMediaType: "application/vnd.tavonel.v1+json",
      /*
        G3-021. The document carried a version policy that said how a version is named and
        nothing about how long one lives. The three commitments below are the answer, and they
        are the same three sentences /docs/changelog publishes, so a machine and a reader get
        one policy rather than two.
      */
      documentation: "https://tavonel.com/docs/changelog",
      additiveChangesWithoutNotice: "New fields, new optional parameters, new endpoints and new enum members on a response may appear in any release. Ignore fields you do not recognise.",
      breakingChangeNotice: "A removal or an incompatible change to a published field, parameter or code takes a new path major. The current major is announced as deprecated in the changelog and in the response header before the new one becomes the default.",
      supportWindow: "A deprecated path major keeps answering for at least 180 days from the announcement. No version has been deprecated; v1 is the only major and it is current.",
    },
    /*
      The whole error catalogue, machine-readable, because a code without a remediation is where
      a generated client stops being useful (G3-019/G3-020). `status` is present only where one
      route owns the code -- the same code is a 404 on one route and a 422 on another, and the
      authoritative status per operation is the key it sits under in `responses`.
    */
    "x-tavonel-error-catalogue": API_ERROR_CODES,
    "x-tavonel-browser-session-paths": ["/oauth-connectors", "/oauth-connectors/authorize", "/oauth-connectors/connections/{id}", "/developer/keys/{id}/rotate", "/developer/audit", "/reviews"],
    "x-tavonel-decision-gates": { promotion: "browser-session-only", rollback: "browser-session-only", mcp: "read-only" },
  }, { headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" } });
}
