import { gateAdmitsCustomerData, type CustomerDataGateDecision } from "./customerDataGate";
import {
  admitsWorkspace, SCOPED_CUSTOMER_DATA_GATE_SCHEMA,
  type CustomerDataScope, type ScopedReleaseDecision, type WorkspaceGrant,
} from "./scopedCustomerDataGate";

/** Internal authorization assembled after both durable v2 ledgers have been verified. */
export type ScopedCustomerDataAuthorization = {
  allowed: true;
  schemaVersion: typeof SCOPED_CUSTOMER_DATA_GATE_SCHEMA;
  tenantId: string;
  workspaceId: string;
  receiptSha256: string;
  evaluatedAt: string;
  release: ScopedReleaseDecision;
  grant: WorkspaceGrant;
};

export type CustomerDataAuthorization = CustomerDataGateDecision | ScopedCustomerDataAuthorization;

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
    authorization.workspaceId === workspaceId &&
    authorization.receiptSha256 === authorization.grant.grantReceiptSha256 &&
    authorization.evaluatedAt === authorization.release.evaluatedAt &&
    Number.isFinite(now.getTime()) && admitsWorkspace(authorization.release, authorization.grant, {
      tenantId, workspaceId, scope: expectedScope,
      releaseRevision: authorization.release.releaseRevision,
    }, now.toISOString());
}
