/**
 * An in-process stand-in for the one network boundary the compiled retrieval path has.
 *
 * `lib/retrieval-store.ts` is the only module in the retrieval path that talks to the database, and
 * it does so over PostgREST HTTP (`supabaseAdminRequest` -> `fetch`). Replacing `fetch` therefore
 * lets `compileRetrievalArtifacts` and `runRetrievalPipeline` -- the real production functions,
 * unmodified -- execute end to end against rows held in this process. `lib/retrieval-pipeline.test.ts`
 * already uses that seam; this is the same seam with a store behind it instead of fixed answers.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT. This matters more than the harness.
 *
 *   Real: compileRetrievalUnits, the unit rows and their `search_tokens` (computed by the
 *   production `expandedTokens` inside persistRetrievalUnits), the compile-run lifecycle, RRF
 *   fusion, structure ranking, the World Gate, ContextPacket assembly, every abstention decision.
 *
 *   NOT real: the lexical ranking itself. Production ranks with Postgres
 *   `ts_rank_cd(search_vector, to_tsquery('simple', ...))`, a cover-density measure over lexeme
 *   positions inside a GIN-indexed tsvector. There is no Postgres in this process, so
 *   `standInLexicalRank` below scores a row by summing the occurrences of each matched query token
 *   in its `search_tokens` and orders `rank desc, unit_id asc` the way 0022's SQL does. Candidate
 *   SELECTION (which rows match at all) is the same set Postgres would return for an OR'd tsquery
 *   over the same tokens; candidate ORDER is not. Any figure this harness reports for the compiled
 *   path is therefore a figure for "the compiled pipeline with a stand-in lexical ranker", and the
 *   report says so on every row. `supabase/tests/foundation_retrieval_search_rpc.sql` is what
 *   proves the real RPC bodies, and it needs a database.
 *
 *   Also not real: dense retrieval. No embedder is configured (there is no GPU endpoint here and
 *   this lane may not spend), so the dense source is absent and the pipeline records that in its
 *   own `degradations`. That is the same posture production is in today, not a shortcut.
 */

import { expandedTokens } from "../../lib/lexical-tokens";

type UnitRow = Record<string, unknown>;
type RunRow = Record<string, unknown>;

export type StandInStore = {
  units: UnitRow[];
  runs: RunRow[];
  requests: string[];
  /** Set when a request arrives that this stand-in does not implement, so the run fails loudly. */
  unhandled: string[];
};

export const STANDIN_SUPABASE_URL = "https://ask-eval.invalid";
export const STANDIN_SERVICE_KEY = "sb_secret_ask_eval_standin_key_000000000000";

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

/**
 * Stand-in for `ts_rank_cd`. Documented as a stand-in at the top of this file; the name exists so
 * no reader can mistake the number for the production score.
 */
export function standInLexicalRank(searchTokens: string[], queryTokens: string[]): number {
  const wanted = new Set(queryTokens);
  let matched = 0;
  for (const token of searchTokens) if (wanted.has(token)) matched += 1;
  return matched;
}

function filtersOf(query: string): Map<string, string> {
  const params = new URLSearchParams(query);
  const filters = new Map<string, string>();
  for (const [key, value] of params.entries()) filters.set(key, value);
  return filters;
}

function matchesEq(row: Record<string, unknown>, filters: Map<string, string>, column: string): boolean {
  const filter = filters.get(column);
  if (filter === undefined) return true;
  if (!filter.startsWith("eq.")) return true;
  return String(row[column] ?? "") === filter.slice(3);
}

/**
 * Installs the stand-in as `globalThis.fetch` and returns the store plus a restore function.
 *
 * Anything the retrieval path asks for that is not implemented here is pushed onto `unhandled` AND
 * answered with a 500, so the caller fails closed instead of quietly degrading: a silent 200 for an
 * endpoint this file does not understand would produce a number for a pipeline that never ran.
 */
export function installPostgrestStandIn(): { store: StandInStore; restore: () => void } {
  const store: StandInStore = { units: [], runs: [], requests: [], unhandled: [] };
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = STANDIN_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = STANDIN_SERVICE_KEY;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = href.slice(STANDIN_SUPABASE_URL.length);
    const [route, query = ""] = path.split("?");
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
    store.requests.push(`${method} ${route}`);

    if (route === "/rest/v1/foundation_retrieval_profiles" && method === "POST") {
      return jsonResponse({}, 201);
    }

    if (route === "/rest/v1/foundation_retrieval_compile_runs") {
      if (method === "POST") {
        store.runs.push({ ...(body as RunRow), started_at: new Date().toISOString() });
        return jsonResponse({}, 201);
      }
      if (method === "PATCH") {
        const filters = filtersOf(query);
        for (const run of store.runs) {
          if (matchesEq(run, filters, "workspace_key") && matchesEq(run, filters, "run_id")) {
            Object.assign(run, body as RunRow);
          }
        }
        return jsonResponse({}, 204);
      }
      if (method === "GET") {
        const filters = filtersOf(query);
        const rows = store.runs.filter(
          (run) =>
            matchesEq(run, filters, "workspace_key") &&
            matchesEq(run, filters, "collection_id") &&
            matchesEq(run, filters, "world_manifest_digest") &&
            matchesEq(run, filters, "retrieval_profile_id") &&
            matchesEq(run, filters, "status"),
        );
        return jsonResponse(rows.slice(0, Number(filters.get("limit") ?? rows.length)));
      }
    }

    if (route === "/rest/v1/foundation_retrieval_units") {
      if (method === "POST") {
        for (const row of body as UnitRow[]) store.units.push(row);
        return jsonResponse({}, 201);
      }
      if (method === "GET") {
        const filters = filtersOf(query);
        const inFilter = filters.get("unit_id");
        const wanted =
          inFilter && inFilter.startsWith("in.(")
            ? new Set(inFilter.slice(4, -1).split(",").filter((id) => id.length > 0))
            : null;
        const rows = store.units.filter(
          (unit) =>
            matchesEq(unit, filters, "workspace_key") &&
            matchesEq(unit, filters, "compile_run_id") &&
            (wanted === null || wanted.has(String(unit.unit_id))),
        );
        const limit = filters.get("limit");
        return jsonResponse(limit ? rows.slice(0, Number(limit)) : rows);
      }
    }

    if (route === "/rest/v1/rpc/connector_documents_blocked" && method === "POST") {
      // No connector suspension exists for a build-time sample corpus.
      return jsonResponse(false);
    }

    if (route === "/rest/v1/rpc/search_foundation_retrieval_units_lexical" && method === "POST") {
      const args = body as { p_workspace_key: string; p_compile_run_id: string; p_query_tokens: string[]; p_limit: number };
      const queryTokens = [...new Set(args.p_query_tokens)];
      const ranked = store.units
        .filter(
          (unit) =>
            String(unit.workspace_key) === args.p_workspace_key &&
            String(unit.compile_run_id) === args.p_compile_run_id,
        )
        .map((unit) => ({
          unit_id: String(unit.unit_id),
          rank: standInLexicalRank((unit.search_tokens as string[]) ?? [], queryTokens),
        }))
        .filter((row) => row.rank > 0)
        .sort((left, right) => right.rank - left.rank || left.unit_id.localeCompare(right.unit_id))
        .slice(0, args.p_limit);
      return jsonResponse(ranked);
    }

    store.unhandled.push(`${method} ${route}`);
    return jsonResponse({ message: `ask-eval stand-in does not implement ${method} ${route}` }, 500);
  }) as typeof fetch;

  return {
    store,
    restore: () => {
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
      if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    },
  };
}

/** Exported only so the runner can assert the production tokenizer is the one that indexed. */
export const tokenizerUsedByStandIn = expandedTokens;
