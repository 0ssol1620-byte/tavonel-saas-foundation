import { readVerifiedCustomerDataGateDecision } from "./customer-data-gate-store";

/** Check the same workspace-bound, expiring decision used by compilation before intake. */
export async function canAdmitCustomerSource(workspaceKey: string): Promise<boolean> {
  const gate = await readVerifiedCustomerDataGateDecision(workspaceKey, workspaceKey);
  return gate.ok;
}
