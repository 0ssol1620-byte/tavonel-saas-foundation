/*
  TEST-ONLY. A `fetch` stand-in that answers the few PostgREST requests `lib/billing-store.ts`
  makes by running the real SQL function over a psql session (WO-D28-3).

  Fidelity limits, stated so nobody reads a green run wider than it is:
  - It runs as the cluster superuser. RLS, grants, the service role and the PostgREST role switch
    are NOT exercised here; `tenant_rls_matrix.sql` and the hosted db-rehearsal own that.
  - PostgREST itself is absent: no JWT check, no schema cache, no request limits, no content
    negotiation, no retry. Every RPC is `select to_jsonb(public.<fn>(<named args>))`.
  - Argument typing is Postgres' own unknown-literal resolution, not PostgREST's JSON coercion.
  - A failing function becomes HTTP 400 `{code: <sqlstate>, message: <sqlerrm>}`, the shape
    PostgREST uses for a raised exception; the real status mapping is not reproduced.
  - It never answers a request it does not know. Anything else throws `ADAPTER_UNSUPPORTED` (and is
    recorded in `unsupported`, because the code under test may catch the throw): never a fake 200.

  The caller owns the transaction (`begin` ... `rollback`) and the fixture rows; each RPC runs
  inside a plpgsql exception block, so a raised error rolls back that call only, like a request.
*/
import type { PsqlSession } from "../billing-ledger-replay";

export const ADAPTER_UNSUPPORTED = "ADAPTER_UNSUPPORTED";

/** The RPCs billing-store.ts calls. Adding one here is a decision, not a convenience. */
export const SUPPORTED_RPCS: readonly string[] = [
  "issue_foundation_checkout_intent",
  "quarantine_foundation_billing_envelope",
  "apply_foundation_billing_event_v6",
  "apply_foundation_subscription_schedule",
];

export interface RpcCall {
  fn: string;
  ok: boolean;
  /** The raised exception message (`sqlerrm`) of a failed call. */
  error?: string;
  state?: string;
}

export interface PostgrestRpcPsqlAdapter {
  fetch: typeof fetch;
  calls: RpcCall[];
  unsupported: string[];
}

const TAG = "$tavonel_rpc$";
const TRY_SQL = `create or replace function pg_temp.rpc_try(q text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  execute q into r;
  return jsonb_build_object('ok', r);
exception when others then
  return jsonb_build_object('error', sqlerrm, 'state', sqlstate);
end $f$;`;

export function createPostgrestRpcPsqlFetch(session: PsqlSession): PostgrestRpcPsqlAdapter {
  const calls: RpcCall[] = [];
  const unsupported: string[] = [];
  const refuse = (what: string): never => {
    unsupported.push(what);
    throw new Error(`${ADAPTER_UNSUPPORTED}: ${what}`);
  };
  const lit = (v: unknown): string => {
    if (v === null) return "null";
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "boolean") return String(v);
    if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
    return refuse(`argument of type ${typeof v}`);
  };

  async function rpc(fn: string, body: unknown): Promise<Response> {
    if (!SUPPORTED_RPCS.includes(fn)) refuse(`rpc ${fn}`);
    let args: unknown;
    try {
      args = typeof body === "string" ? JSON.parse(body) : undefined;
    } catch {
      args = undefined;
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) return refuse(`rpc ${fn} body is not a JSON object`);
    const named = Object.entries(args as Record<string, unknown>).map(([key, value]) => {
      if (!/^p_[a-z0-9_]+$/.test(key)) refuse(`rpc ${fn} argument ${key}`);
      return `${key} => ${lit(value)}`;
    });
    const sql = `select to_jsonb(public.${fn}(${named.join(", ")}))`;
    if (sql.includes(TAG)) refuse(`rpc ${fn} argument contains the quoting tag`);
    const lines = await session.query(`${TRY_SQL}\nselect pg_temp.rpc_try(${TAG}${sql}${TAG})::text;`);
    const result = JSON.parse(lines[0]) as { ok?: unknown; error?: string; state?: string };
    if (result.error !== undefined) {
      calls.push({ fn, ok: false, error: result.error, state: result.state });
      return Response.json({ code: result.state, message: result.error }, { status: 400 });
    }
    calls.push({ fn, ok: true });
    return Response.json(result.ok ?? null);
  }

  // GET /rest/v1/foundation_billing_accounts?select=a,b&workspace_key=eq.x&user_id=eq.y&limit=1
  async function accounts(params: URLSearchParams): Promise<Response> {
    const select = params.get("select") ?? "";
    if (!/^[a-z_]+(,[a-z_]+)*$/.test(select)) refuse("accounts select");
    const where: string[] = [];
    for (const [key, value] of params) {
      if (key === "select" || key === "limit") continue;
      const eq = /^eq\.([A-Za-z0-9_-]+)$/.exec(value);
      if (!["workspace_key", "user_id"].includes(key) || !eq) refuse(`accounts filter ${key}=${value}`);
      where.push(`${key} = ${lit((eq as RegExpExecArray)[1])}`);
    }
    const limit = params.get("limit") ?? "1";
    if (!/^\d{1,3}$/.test(limit)) refuse("accounts limit");
    const sql = `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from (select ${select} from public.foundation_billing_accounts` +
      `${where.length ? ` where ${where.join(" and ")}` : ""} limit ${limit}) t;`;
    const lines = await session.query(sql);
    return Response.json(JSON.parse(lines[0]));
  }

  const adapterFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const named = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
    if (method === "POST" && named) return rpc(named[1], init.body);
    if (method === "GET" && url.pathname === "/rest/v1/foundation_billing_accounts") return accounts(url.searchParams);
    return refuse(`${method} ${url.pathname}`);
  }) as typeof fetch;

  return { fetch: adapterFetch, calls, unsupported };
}
