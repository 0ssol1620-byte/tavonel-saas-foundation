import { DOCUMENT_ID_PATTERN, WORKSPACE_ID_PATTERN } from "./immutable-keys";

export type FoundationSealClaim = {
  stageId: string;
  preflightApprovalId: string;
  workspaceKey: string;
  actorUserId: string;
  state: string;
  sealToken: string;
  fenceGeneration: number;
  documentId: string;
  sealedSourceKey: string;
  sealLeaseUntil: string;
  relativePath: string;
  declaredMimeType: string;
  requestedBytes: number;
};

/** Each lease token is also its one-use document identity, so stale writes get different keys. */
export function foundationTriageSealObjectKey(workspaceKey: string, documentId: string) {
  if (!WORKSPACE_ID_PATTERN.test(workspaceKey) || !DOCUMENT_ID_PATTERN.test(documentId)) return null;
  return `quarantine/${workspaceKey}/${documentId}/source`;
}

export function validateFoundationTriageSealClaim(value: {
  claim: unknown;
  workspaceKey: string;
  actorUserId: string;
  stageId: string;
  preflightApprovalId: string;
  sealToken: string;
  now?: number;
}): FoundationSealClaim | null {
  if (!value.claim || typeof value.claim !== "object" || Array.isArray(value.claim)) return null;
  const claim = value.claim as Partial<FoundationSealClaim>;
  const key = foundationTriageSealObjectKey(value.workspaceKey, value.sealToken);
  if (!key || claim.workspaceKey !== value.workspaceKey || claim.actorUserId !== value.actorUserId
    || claim.stageId !== value.stageId || claim.preflightApprovalId !== value.preflightApprovalId || claim.state !== "sealing"
    || claim.sealToken !== value.sealToken || claim.documentId !== value.sealToken
    || !Number.isSafeInteger(claim.fenceGeneration) || (claim.fenceGeneration ?? 0) < 1
    || claim.sealedSourceKey !== key || typeof claim.sealLeaseUntil !== "string"
    || typeof claim.relativePath !== "string" || claim.relativePath.length < 1 || claim.relativePath.length > 1024
    || claim.relativePath.startsWith("/") || claim.relativePath.startsWith("\\")
    || /[\u0000-\u001f\u007f]/.test(claim.relativePath)
    || claim.relativePath.replace(/\\/g, "/").split("/").some((part) => !part || part === "." || part === "..")
    || typeof claim.declaredMimeType !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9!#&^_.+-]{0,78}\/[A-Za-z0-9][A-Za-z0-9!#&^_.+-]{0,78}$/.test(claim.declaredMimeType)
    || !Number.isSafeInteger(claim.requestedBytes) || (claim.requestedBytes ?? 0) < 1
    || (claim.requestedBytes ?? 0) > 5 * 1024 * 1024
    || Date.parse(claim.sealLeaseUntil) <= (value.now ?? Date.now())) return null;
  return claim as FoundationSealClaim;
}
