import { WORKSPACE_ID_PATTERN } from "./immutable-keys";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

// Both tables key document_id as uuid and PostgREST renders it lowercase, so only the
// canonical form can be compared by string equality against what the store returns.
const DOCUMENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_DOCUMENTS = 2000;
// ~3.8 KB of ids per request URL; each table is unique on (workspace_key, document_id),
// so a batch can never legitimately return more rows than it asked for.
const BATCH_SIZE = 100;

export type CustomerSourceScope = "direct_upload" | "connector";
export type CustomerSourceScopeResult =
  | { ok: true; scope: CustomerSourceScope }
  | { ok: false; code: "CUSTOMER_SOURCE_SCOPE_INVALID" | "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" };

type Config = NonNullable<ReturnType<typeof readSupabaseAdminConfig>>;

/**
 * Derive a customer-data scope from durable origin evidence only. A caller never names the
 * source kind: a connector binding for any document makes the set connector-scoped, and every
 * document must be accounted for by a binding or an intake admission in this exact workspace.
 * Anything unexplained -- unknown origin, foreign row, outage, truncated page -- fails closed.
 */
export async function readCustomerSourceScope(
  workspaceKey: string,
  documentIds: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<CustomerSourceScopeResult> {
  if (typeof workspaceKey !== "string" || !WORKSPACE_ID_PATTERN.test(workspaceKey) ||
      !Array.isArray(documentIds) || documentIds.length === 0 || documentIds.length > MAX_DOCUMENTS ||
      documentIds.some((id) => typeof id !== "string" || !DOCUMENT_UUID.test(id))) {
    return { ok: false, code: "CUSTOMER_SOURCE_SCOPE_INVALID" };
  }
  const config = readSupabaseAdminConfig(env);
  if (!config) return { ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" };
  const ids = [...new Set(documentIds)];

  const bound = await readPresentDocuments(config, "connector_document_bindings", workspaceKey, ids);
  if (!bound) return { ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" };
  const unbound = ids.filter((id) => !bound.has(id));
  if (unbound.length > 0) {
    const admitted = await readPresentDocuments(config, "foundation_intake_admissions", workspaceKey, unbound);
    if (!admitted) return { ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" };
    if (unbound.some((id) => !admitted.has(id))) return { ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" };
  }
  return { ok: true, scope: bound.size > 0 ? "connector" : "direct_upload" };
}

/** Returns the subset of `ids` with a row in `table` for this workspace, or null if unprovable. */
async function readPresentDocuments(
  config: Config,
  table: "connector_document_bindings" | "foundation_intake_admissions",
  workspaceKey: string,
  ids: readonly string[],
): Promise<Set<string> | null> {
  const present = new Set<string>();
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const batch = ids.slice(start, start + BATCH_SIZE);
    const requested = new Set(batch);
    const path = `/rest/v1/${table}?select=workspace_key,document_id` +
      `&workspace_key=eq.${encodeURIComponent(workspaceKey)}` +
      `&document_id=in.(${batch.join(",")})&limit=${batch.length}` +
      (table === "foundation_intake_admissions" ? "&confirmed_at=not.is.null" : "");
    try {
      const response = await supabaseAdminRequest(config, path, { headers: { Prefer: "count=exact" } });
      if (!response.ok) return null;
      const rows: unknown = await response.json();
      if (!Array.isArray(rows) || rows.length > batch.length) return null;
      // A server-side max-rows cap would drop rows silently; the exact count exposes it.
      const total = /\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1];
      if (total === undefined || Number(total) !== rows.length) return null;
      for (const row of rows) {
        if (!row || typeof row !== "object") return null;
        const { workspace_key, document_id } = row as Record<string, unknown>;
        if (workspace_key !== workspaceKey || typeof document_id !== "string" ||
            !requested.has(document_id) || present.has(document_id)) return null;
        present.add(document_id);
      }
    } catch {
      return null;
    }
  }
  return present;
}
