import { readCustomerSourceAuthorization } from "./customer-data-admission";
import { readCustomerSourceScope } from "./customer-source-scope";

export const DERIVED_DATA_REFUSED = "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE";

/**
 * Whether content derived from these sources may be served (or regenerated) right now.
 *
 * Only the v2 rollout adds this check; v1 serving is unchanged. Scope comes from the durable
 * origin of the documents behind the content, never from the request. An origin that cannot be
 * proven -- unknown, foreign, unreadable -- refuses access. A mixed set is connector-scoped. A refused, stale or revoked release or workspace grant
 * refuses. Original-source download and deletion deliberately do not call this.
 */
export async function admitsDerivedCustomerData(
  workspaceKey: string,
  documentIds: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<boolean> {
  const version = env.TAVONEL_CUSTOMER_DATA_GATE_VERSION;
  if (version === undefined || version === "" || version === "v1") return true;
  const origin = await readCustomerSourceScope(workspaceKey, documentIds, env);
  if (!origin.ok) return false;
  return (await readCustomerSourceAuthorization(workspaceKey, origin.scope, env)).ok;
}
