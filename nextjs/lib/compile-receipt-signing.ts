import {
  COMPILE_RECEIPT_SIGNATURE_SCOPE,
  readExportSignerEnv,
  verifyExportSignatureWithTrustStore,
  type ExportSignatureV2,
  type ExportSigner,
  type ExportTrustStore,
} from "./export-signing";

/*
  Gate precondition 8, `compile_receipts_signed_and_audited`.

  A compile receipt is an allowlist of identifiers and digests -- tenant, workspace, collection,
  manifest, Core request and output digest, the gate receipt that admitted the compile, and the
  document/version ids it read. Nothing is copied from the Core's receipt wholesale and no OCR
  text, key, bucket name or object body can reach it: every field is checked against a shape that
  has no room for one, and a value that does not fit refuses the receipt rather than dropping it.

  It is signed with the export Ed25519 key under its own protected-header scope, and only by a
  lifecycle (v2) signer: without a trust store nobody could verify the receipt later, so an
  unverifiable signature is treated as no signature.
*/

export const COMPILE_RECEIPT_SCHEMA = "tavonel.compile_receipt.v1" as const;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const VERSION_KEY = /^[a-f0-9]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_DOCUMENTS = 128;

export type CompileReceiptPayload = {
  schemaVersion: typeof COMPILE_RECEIPT_SCHEMA;
  tenantId: string;
  workspaceId: string;
  collectionId: string;
  manifestDigest: string;
  lifecycle: string;
  coreRuntime: string;
  worldStateId: string | null;
  coreRequestId: string;
  coreOutputSha256: string;
  customerDataGateReceiptSha256: string;
  sourceDocuments: Array<{ documentId: string; versionKey: string }>;
  compiledAt: string;
};

export type SignedCompileReceipt = {
  payloadJson: string;
  signature: ExportSignatureV2;
};

type Env = Readonly<Record<string, string | undefined>>;

export function readCompileReceiptSigner(env: Env = process.env, now = new Date()): ExportSigner | null {
  const signer = readExportSignerEnv(env, now, COMPILE_RECEIPT_SIGNATURE_SCOPE);
  return signer?.keyVersion ? signer : null;
}

/** Rebuilds the payload field by field, so an unknown key or an off-shape value never survives. */
function normalizePayload(value: unknown): CompileReceiptPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const ids = ["tenantId", "workspaceId", "collectionId", "lifecycle", "coreRuntime", "coreRequestId"] as const;
  const digests = ["manifestDigest", "coreOutputSha256", "customerDataGateReceiptSha256"] as const;
  if (
    input.schemaVersion !== COMPILE_RECEIPT_SCHEMA ||
    ids.some((key) => typeof input[key] !== "string" || !IDENTIFIER.test(input[key] as string)) ||
    digests.some((key) => typeof input[key] !== "string" || !SHA256.test(input[key] as string)) ||
    (input.worldStateId !== null && (typeof input.worldStateId !== "string" || !IDENTIFIER.test(input.worldStateId))) ||
    !isInstant(input.compiledAt) ||
    !Array.isArray(input.sourceDocuments) || input.sourceDocuments.length === 0 ||
    input.sourceDocuments.length > MAX_DOCUMENTS
  ) return null;
  const sourceDocuments: CompileReceiptPayload["sourceDocuments"] = [];
  for (const item of input.sourceDocuments as unknown[]) {
    const row = item as Record<string, unknown> | null;
    if (!row || typeof row.documentId !== "string" || !IDENTIFIER.test(row.documentId) ||
      typeof row.versionKey !== "string" || !VERSION_KEY.test(row.versionKey)) return null;
    sourceDocuments.push({ documentId: row.documentId, versionKey: row.versionKey });
  }
  return {
    schemaVersion: COMPILE_RECEIPT_SCHEMA,
    tenantId: input.tenantId as string,
    workspaceId: input.workspaceId as string,
    collectionId: input.collectionId as string,
    manifestDigest: input.manifestDigest as string,
    lifecycle: input.lifecycle as string,
    coreRuntime: input.coreRuntime as string,
    worldStateId: input.worldStateId as string | null,
    coreRequestId: input.coreRequestId as string,
    coreOutputSha256: input.coreOutputSha256 as string,
    customerDataGateReceiptSha256: input.customerDataGateReceiptSha256 as string,
    sourceDocuments,
    compiledAt: input.compiledAt as string,
  };
}

// The day must spell itself back: `2026-02-30` parses, and means March.
function isInstant(value: unknown) {
  if (typeof value !== "string" || !INSTANT.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function signCompileReceipt(
  signer: ExportSigner,
  input: Omit<CompileReceiptPayload, "schemaVersion">,
): { receipt: SignedCompileReceipt; payload: CompileReceiptPayload } | null {
  const payload = normalizePayload({ ...input, schemaVersion: COMPILE_RECEIPT_SCHEMA });
  if (!payload) return null;
  const payloadJson = JSON.stringify(payload);
  const signature = signer.signPayload(Buffer.from(payloadJson, "utf8"));
  if (signature.schemaVersion !== "tavonel.export_signature.v2" ||
    signature.signatureScope !== COMPILE_RECEIPT_SIGNATURE_SCOPE) return null;
  return { receipt: { payloadJson, signature }, payload };
}

export type CompileReceiptVerification =
  | { ok: true; payload: CompileReceiptPayload }
  | { ok: false; code: "COMPILE_RECEIPT_SIGNATURE_INVALID" | "COMPILE_RECEIPT_MALFORMED" | "COMPILE_RECEIPT_SUBJECT_MISMATCH" };

/**
 * Signature first, over the exact stored bytes; then shape; then subject. A receipt is only
 * evidence for the tenant and workspace it names, so a valid receipt presented for another
 * tenant is refused like a forged one.
 */
export function verifyCompileReceipt(
  receipt: SignedCompileReceipt,
  expected: { tenantId: string; workspaceId: string },
  trust: ExportTrustStore,
  now = new Date(),
): CompileReceiptVerification {
  if (!receipt || typeof receipt.payloadJson !== "string" || !receipt.signature ||
    !verifyExportSignatureWithTrustStore(Buffer.from(receipt.payloadJson, "utf8"), receipt.signature, trust, now,
      COMPILE_RECEIPT_SIGNATURE_SCOPE)) {
    return { ok: false, code: "COMPILE_RECEIPT_SIGNATURE_INVALID" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(receipt.payloadJson);
  } catch {
    return { ok: false, code: "COMPILE_RECEIPT_MALFORMED" };
  }
  const payload = normalizePayload(parsed);
  if (!payload || JSON.stringify(payload) !== receipt.payloadJson) return { ok: false, code: "COMPILE_RECEIPT_MALFORMED" };
  if (payload.tenantId !== expected.tenantId || payload.workspaceId !== expected.workspaceId) {
    return { ok: false, code: "COMPILE_RECEIPT_SUBJECT_MISMATCH" };
  }
  return { ok: true, payload };
}

/** The audit row's details: identifiers and digests only, never the payload's source list. */
export function compileReceiptAuditDetails(receipt: SignedCompileReceipt, payload: CompileReceiptPayload) {
  return {
    schemaVersion: payload.schemaVersion,
    receiptSha256: receipt.signature.signedPayloadSha256,
    signatureScope: receipt.signature.signatureScope,
    keyId: receipt.signature.keyId,
    keyVersion: receipt.signature.keyVersion,
    collectionId: payload.collectionId,
    manifestDigest: payload.manifestDigest,
    lifecycle: payload.lifecycle,
    coreRequestId: payload.coreRequestId,
    coreOutputSha256: payload.coreOutputSha256,
    customerDataGateReceiptSha256: payload.customerDataGateReceiptSha256,
    documentCount: payload.sourceDocuments.length,
    compiledAt: payload.compiledAt,
  };
}
