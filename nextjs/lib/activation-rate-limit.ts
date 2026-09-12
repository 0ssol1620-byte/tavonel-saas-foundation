import { WORKSPACE_ID_PATTERN } from "./immutable-keys";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  A per-workspace ceiling on the three self-serve actions that spend embedder time.

  FD-02 (`docs/policy/DECISION_LOG_2026-09-11.md`) opened World promotion, rollback and the
  retrieval-index rebuild to the Developer plan when the caller owns the workspace. Team was
  effectively rate-limited by a person: it is sold through a conversation, so somebody met the
  buyer before they could reach the GPU pipeline. Developer is a card and a form. The three
  routes had no call-frequency limit of any kind -- `consumeDeveloperApiRateLimit` covers the
  `/api/v1` API-key surface and never runs on a session-authenticated promote -- so a stolen
  card plus a loop reached the embedder as often as it liked.

  Durable by construction, because this runs on serverless: a counter in module memory is per
  instance and per cold start, which is not a limit. Nothing new is stored either. Both actions
  already write a durable, workspace-scoped, timestamped row as their own record of having
  happened, and counting those rows over the last hour is the limit:

    promote / rollback   -> `foundation_world_events`            (0007, `created_at`)
    retrieval rebuild    -> `foundation_retrieval_compile_runs`  (0020, `started_at`)

  Both are indexed on `(workspace_key, ...)` and the read asks for at most `LIMIT` rows.

  ponytail: this counts *completed* actions, so a caller whose promotes all fail their gates is
  not slowed by it. That is the honest shape of a limiter built from the audit trail rather than
  from a new counter -- and the failing calls it does not count are the ones that spend no
  embedder time. A limiter that also bounds refused attempts needs a row of its own (a
  `workspace_action_windows` table, or the pattern 0012's `consume_foundation_api_rate_limit`
  already uses), which is a migration, and the 2026-09-11 release is closed at four.
*/

export type ActivationLimitedAction = "world_activation" | "retrieval_index_rebuild";

/** Per workspace, per action family, per window. */
export const ACTIVATION_RATE_LIMIT = 20;
export const ACTIVATION_RATE_WINDOW_SECONDS = 3_600;

const SOURCE: Record<ActivationLimitedAction, { table: string; column: string }> = {
  world_activation: { table: "foundation_world_events", column: "created_at" },
  retrieval_index_rebuild: { table: "foundation_retrieval_compile_runs", column: "started_at" },
};

export type ActivationRateVerdict =
  | { ok: true }
  /**
   * 429, and never 402: the workspace is not out of money, it has used its share of the
   * pipeline for this hour. A client library should back off rather than ask for a card.
   */
  | { ok: false; code: "ACTIVATION_RATE_LIMITED"; status: 429; retryAfterSeconds: number }
  /**
   * The ceiling could not be read, so the request is refused rather than let through. Fail
   * closed: an unbounded promote path is the thing this exists to prevent, and the promote
   * itself needs the same database a moment later anyway.
   */
  | { ok: false; code: "ACTIVATION_RATE_LIMIT_UNAVAILABLE"; status: 503; retryAfterSeconds: number };

export async function checkActivationRateLimit(
  workspaceKey: string,
  action: ActivationLimitedAction,
): Promise<ActivationRateVerdict> {
  const unavailable = {
    ok: false as const,
    code: "ACTIVATION_RATE_LIMIT_UNAVAILABLE" as const,
    status: 503 as const,
    retryAfterSeconds: 60,
  };
  if (!WORKSPACE_ID_PATTERN.test(workspaceKey)) return unavailable;
  const config = readSupabaseAdminConfig();
  if (!config) return unavailable;

  const source = SOURCE[action];
  const since = new Date(Date.now() - ACTIVATION_RATE_WINDOW_SECONDS * 1_000).toISOString();
  const query = new URLSearchParams({
    workspace_key: `eq.${workspaceKey}`,
    [source.column]: `gte.${since}`,
    select: source.column,
    order: `${source.column}.asc`,
    limit: String(ACTIVATION_RATE_LIMIT),
  });

  let rows: Array<Record<string, unknown>> | null;
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/${source.table}?${query}`);
    if (!response.ok) return unavailable;
    rows = (await response.json().catch(() => null)) as Array<Record<string, unknown>> | null;
  } catch {
    return unavailable;
  }
  if (!Array.isArray(rows)) return unavailable;
  if (rows.length < ACTIVATION_RATE_LIMIT) return { ok: true };

  /*
    Sliding, not fixed: the window reopens when the oldest counted row leaves it, which is the
    honest Retry-After rather than the top of the next hour. A row whose timestamp will not parse
    is treated as the full window, because the alternative is advertising a retry that refuses.
  */
  const oldest = Date.parse(String(rows[0]?.[source.column] ?? ""));
  const reopensAt = Number.isFinite(oldest)
    ? oldest + ACTIVATION_RATE_WINDOW_SECONDS * 1_000
    : Date.now() + ACTIVATION_RATE_WINDOW_SECONDS * 1_000;
  return {
    ok: false,
    code: "ACTIVATION_RATE_LIMITED",
    status: 429,
    retryAfterSeconds: Math.max(1, Math.ceil((reopensAt - Date.now()) / 1_000)),
  };
}
