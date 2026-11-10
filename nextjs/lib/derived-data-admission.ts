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
  return (await derivedCustomerDataRefusal(workspaceKey, documentIds, env)) === null;
}

export type DerivedDataRefusal =
  | { code: typeof DERIVED_DATA_REFUSED; status: 403 }
  | { code: "CUSTOMER_SOURCE_ORIGIN_UNPROVEN"; status: 409; documentIds: string[] }
  | { code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE"; status: 503 };

/**
 * The same decision as `admitsDerivedCustomerData`, with the reason, so a route can tell the three
 * apart: the workspace has not accepted processing (403), these documents have no provable origin
 * and must be uploaded again (409, naming them), or the store could not be read (503). All three
 * refuse; only the first was ever reported, so an unreadable store read as "not enabled".
 */
export async function derivedCustomerDataRefusal(
  workspaceKey: string,
  documentIds: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<DerivedDataRefusal | null> {
  const version = env.TAVONEL_CUSTOMER_DATA_GATE_VERSION;
  if (version === undefined || version === "" || version === "v1") return null;
  const origin = await readCustomerSourceScope(workspaceKey, documentIds, env);
  if (!origin.ok) {
    if (origin.code === "CUSTOMER_SOURCE_ORIGIN_UNPROVEN") return { code: origin.code, status: 409, documentIds: origin.documentIds };
    if (origin.code === "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE") return { code: origin.code, status: 503 };
    return { code: DERIVED_DATA_REFUSED, status: 403 };
  }
  return (await readCustomerSourceAuthorization(workspaceKey, origin.scope, env)).ok ? null : { code: DERIVED_DATA_REFUSED, status: 403 };
}
