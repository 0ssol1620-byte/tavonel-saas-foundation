import { COMPILE_RECEIPT_SCHEMA, verifyCompileReceipt, type SignedCompileReceipt } from "./compile-receipt-signing";
import { PRODUCT_CORE_RESPONSE_SCHEMA } from "./core-runtime-v2";
import { readExportTrustStoreEnv } from "./export-signing";

export type CandidateReceiptCheck =
  | { ok: true }
  | { ok: false; code: string; status: 409 | 503 };

type Subject = { workspaceId: string; collectionId: string; manifestDigest: string;
  /** The source classification now (`classifyCompileJobSources`); a v2 receipt signed for another scope is refused. */
  currentScope?: "direct_upload" | "connector";
};

const pairs = (docs: unknown) =>
  Array.isArray(docs)
    ? docs.map((d) => `${(d as { documentId?: unknown })?.documentId}\u0000${(d as { versionKey?: unknown })?.versionKey}`).sort()
    : null;

/**
 * Promote and rollback act on a stored candidate, so the signature Product put on it at compile
 * time is checked here, over the stored bytes, and the signed payload must describe the very
 * artifact being activated. No signature, no trust store, or any mismatch refuses (decision D3:
 * a candidate written before signing existed is recompiled, not grandfathered).
 */
export function checkCandidateCompileReceipt(
  stored: unknown,
  subject: Subject,
  env: Readonly<Record<string, string | undefined>> = process.env,
  now = new Date(),
): CandidateReceiptCheck {
  const artifact = (stored ?? {}) as {
    signedReceipt?: SignedCompileReceipt;
    manifestDigest?: unknown;
    sourceDocuments?: unknown;
    coreExecution?: { runtime?: unknown; worldStateId?: unknown; receipt?: { outputSha256?: unknown; requestId?: unknown } };
  };
  if (!artifact.signedReceipt) return { ok: false, code: "COMPILE_RECEIPT_REQUIRED", status: 409 };
  const trust = readExportTrustStoreEnv(env);
  if (!trust) return { ok: false, code: "EXPORT_TRUST_STORE_NOT_CONFIGURED", status: 503 };
  const verified = verifyCompileReceipt(
    artifact.signedReceipt,
    { tenantId: subject.workspaceId, workspaceId: subject.workspaceId },
    trust,
    now,
  );
  if (!verified.ok) return { ok: false, code: verified.code, status: 409 };
  const p = verified.payload;
  if (p.schemaVersion === COMPILE_RECEIPT_SCHEMA) {
    if (p.coreResponseSchema !== PRODUCT_CORE_RESPONSE_SCHEMA) return { ok: false, code: "COMPILE_RECEIPT_MALFORMED", status: 409 };
    if (subject.currentScope && p.sourceScope !== subject.currentScope) {
      return { ok: false, code: "WORLD_CANDIDATE_SCOPE_CHANGED", status: 409 };
    }
  }
  const core = artifact.coreExecution;
  const signedPairs = pairs(p.sourceDocuments);
  const storedPairs = pairs(artifact.sourceDocuments);
  const same =
    p.collectionId === subject.collectionId &&
    p.manifestDigest === subject.manifestDigest &&
    artifact.manifestDigest === subject.manifestDigest &&
    p.coreRuntime === "tavonel-python-core-v2" &&
    core?.runtime === p.coreRuntime &&
    core?.worldStateId === p.worldStateId &&
    core?.receipt?.outputSha256 === p.coreOutputSha256 &&
    core?.receipt?.requestId === p.coreRequestId &&
    storedPairs !== null && signedPairs !== null &&
    storedPairs.length === signedPairs.length &&
    storedPairs.every((v, i) => v === signedPairs[i]);
  return same ? { ok: true } : { ok: false, code: "COMPILE_RECEIPT_SUBJECT_MISMATCH", status: 409 };
}
