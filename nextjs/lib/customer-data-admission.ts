import { readVerifiedCustomerDataGateDecision } from "./customer-data-gate-store";
import { readVerifiedScopedCustomerDataGate } from "./scoped-customer-data-gate-store";
import { processingCohortRefusal } from "./processing-workspace-grant";
import type { CustomerDataScope } from "../../shared/scopedCustomerDataGate";
import type { CustomerDataAuthorization } from "../../shared/customerDataAuthorization";

export { authorizationStage } from "../../shared/customerDataAuthorization";

export type SourceAuthorizationResult =
  | { ok: true; decision: Extract<CustomerDataAuthorization, { allowed: true }> }
  | { ok: false; code: string };

/**
 * Scope is selected by the server entry point, never by upload metadata. The v2 rollout
 * cannot fall back to an older approval when the scoped release or workspace grant refuses.
 * Production evidence is bound to the actual deployment revision supplied by Vercel.
 */
export async function readCustomerSourceAuthorization(
  workspaceKey: string,
  scope: CustomerDataScope,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<SourceAuthorizationResult> {
  // A rollout cohort only narrows: it refuses existing grants too, and never stands in for one.
  const cohort = processingCohortRefusal(workspaceKey, env);
  if (cohort) return { ok: false, code: cohort };
  const version = env.TAVONEL_CUSTOMER_DATA_GATE_VERSION;
  if (version === "v2") {
    const revision = env.VERCEL_GIT_COMMIT_SHA;
    if (!revision || !/^[a-f0-9]{40}$/.test(revision)) return { ok: false, code: "SCOPED_GATE_INPUT_INVALID" };
    const scoped = await readVerifiedScopedCustomerDataGate(
      workspaceKey, workspaceKey, scope, revision, new Date(), env,
    );
    return scoped.ok ? { ok: true, decision: scoped.authorization } : scoped;
  }
  if (version !== undefined && version !== "" && version !== "v1") return { ok: false, code: "SOURCE_GATE_VERSION_INVALID" };
  return readVerifiedCustomerDataGateDecision(workspaceKey, workspaceKey);
}

export async function canAdmitCustomerSource(
  workspaceKey: string,
  scope: CustomerDataScope,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<boolean> {
  return (await readCustomerSourceAuthorization(workspaceKey, scope, env)).ok;
}
