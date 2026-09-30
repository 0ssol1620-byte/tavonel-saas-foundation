import { gateAdmitsCustomerData, type CustomerDataGateDecision } from "./customerDataGate";
import {
  admitsWorkspace, SCOPED_CUSTOMER_DATA_GATE_SCHEMA,
  type CustomerDataScope, type ReleaseStage, type ScopedReleaseDecision, type WorkspaceGrant,
} from "./scopedCustomerDataGate";

/** Internal authorization assembled after both durable v2 ledgers have been verified. */
export type ScopedCustomerDataAuthorization = {
  allowed: true;
  schemaVersion: typeof SCOPED_CUSTOMER_DATA_GATE_SCHEMA;
  /** `qualification` admits processing for one workspace and nothing commercial. */
  stage: ReleaseStage;
  tenantId: string;
  workspaceId: string;
  receiptSha256: string;
  evaluatedAt: string;
  release: ScopedReleaseDecision;
  grant: WorkspaceGrant;
};

export type CustomerDataAuthorization = CustomerDataGateDecision | ScopedCustomerDataAuthorization;

/**
 * The stage a verified authorization was issued under. The v1 receipt demands all 17 conditions
 * and has no qualification form. Anything unrecognised reads as qualification, so billing that
 * requires `production` fails closed.
 */
export function authorizationStage(authorization: Extract<CustomerDataAuthorization, { allowed: true }>): ReleaseStage {
  if (authorization.schemaVersion !== SCOPED_CUSTOMER_DATA_GATE_SCHEMA) return "production";
  const scoped = authorization as ScopedCustomerDataAuthorization;
  return scoped.stage === "production" && scoped.release?.stage === "production" && scoped.grant?.stage === "production"
    ? "production" : "qualification";
}

export function authorizationAdmitsCustomerData(
  authorization: CustomerDataAuthorization | undefined,
  tenantId: string,
  workspaceId: string,
  now = new Date(),
  expectedScope?: CustomerDataScope,
): boolean {
  if (authorization?.schemaVersion !== SCOPED_CUSTOMER_DATA_GATE_SCHEMA) {
    return gateAdmitsCustomerData(authorization, tenantId, workspaceId);
  }
  return expectedScope !== undefined && authorization.release != null && authorization.grant != null &&
    authorization.allowed === true && authorization.tenantId === tenantId &&
    authorization.workspaceId === workspaceId && authorization.stage === authorization.release.stage &&
    authorization.receiptSha256 === authorization.grant.grantReceiptSha256 &&
    authorization.evaluatedAt === authorization.release.evaluatedAt &&
    Number.isFinite(now.getTime()) && admitsWorkspace(authorization.release, authorization.grant, {
      tenantId, workspaceId, scope: expectedScope,
      releaseRevision: authorization.release.releaseRevision,
    }, now.toISOString());
}
