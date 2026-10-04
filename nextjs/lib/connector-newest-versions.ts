import type { readSupabaseAdminConfig } from "./supabase-admin";
import { supabaseAdminRequest } from "./supabase-admin";

type SupabaseAdminConfig = NonNullable<ReturnType<typeof readSupabaseAdminConfig>>;
const VERSION_ID = /^sv-[a-f0-9]{64}$/;

/*
  The effective newest bindings of one logical source, as `connector_source_newest_versions`
  computes them in SQL: every binding at the newest observation instant, at PostgreSQL's own
  microsecond precision, unless an immutable tie resolution names the provider's current revision of
  exactly that set. One id is a unique latest, none an unbound source, several an unresolved tie.
  The import snapshot, the guarded writer and compile selection all read this one definition; no
  timestamp is parsed or compared here and no provider value orders anything.
*/
export async function readConnectorNewestVersions(config: SupabaseAdminConfig, workspaceKey: string, sourceId: string): Promise<
  { ok: true; sourceVersionIds: string[] } | { ok: false }
> {
  const response = await supabaseAdminRequest(config, "/rest/v1/rpc/connector_source_newest_versions", {
    method: "POST", body: JSON.stringify({ p_workspace_key: workspaceKey, p_source_id: sourceId }),
  });
  if (!response.ok) return { ok: false };
  const ids: unknown = await response.json();
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !VERSION_ID.test(id)) || new Set(ids).size !== ids.length) {
    return { ok: false };
  }
  return { ok: true, sourceVersionIds: [...(ids as string[])].sort() };
}
