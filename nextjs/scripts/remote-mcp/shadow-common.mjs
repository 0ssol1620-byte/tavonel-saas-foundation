/**
 * W1-A1 remote MCP shadow harness: a synthetic store, a `next start` of the local build, and an
 * MCP/OAuth client written against the specs rather than against this server.
 *
 * What is real: the built Next server, every route handler, the OAuth sealing, the PKCE and
 * resource checks, the developer-key authentication and scope checks, the tenant scoping in the
 * route handlers, the processing-cohort gate and the MCP transport.
 *
 * What is synthetic, and says so in every receipt: the PostgREST store (an in-memory table set
 * implementing the few RPCs this path calls, `consume_foundation_api_rate_limit` included), the
 * Supabase Auth `/auth/v1/user` answer, an empty synthetic R2 bucket, and no retrieval runtime -- so a
 * tool that needs object storage or an index answers with that route's own refusal, which is
 * recorded rather than hidden. No production secret, URL or key is read or needed: the server is
 * started with an allowlisted environment, and loopback-fetch.mjs refuses every non-loopback
 * request.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hex = (value) => createHash("sha256").update(value).digest("hex");

export const USERS = {
  a: { id: "a1111111-1111-4111-8111-111111111111", session: `session-a-${randomBytes(8).toString("hex")}` },
  b: { id: "b2222222-2222-4222-8222-222222222222", session: `session-b-${randomBytes(8).toString("hex")}` },
  // Signed in and a pilot member, but outside the processing cohort.
  c: { id: "c3333333-3333-4333-8333-333333333333", session: `session-c-${randomBytes(8).toString("hex")}` },
};
export const workspaceOf = (userId) => `pilot-${userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`;
export const COLLECTION_A = `collection-${"a".repeat(32)}`;
const DIGEST_A = `sha256:${"d".repeat(64)}`;

export async function freePort() {
  return new Promise((settle) => {
    const probe = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => settle(port));
    });
  });
}

/* ------------------------------------------------------------------ store */

export function createStore() {
  const now = () => new Date().toISOString();
  const tables = {
    foundation_workspace_members: Object.values(USERS).map((user) => ({
      workspace_key: workspaceOf(user.id), user_id: user.id, role: "owner", state: "active",
      accepted_at: "2026-11-01T00:00:00.000Z", revoked_at: null, authorization_revision: 1,
    })),
    foundation_account_access_grants: Object.values(USERS).map((user) => ({
      user_id: user.id, grant_kind: "owner", access_plan: "studio_access", billing_exempt: true, trial_exempt: true, active: true,
    })),
    foundation_active_worlds: [{
      workspace_key: workspaceOf(USERS.a.id), collection_id: COLLECTION_A, manifest_digest: DIGEST_A, revision: 1, updated_at: "2026-11-04T00:00:00.000Z",
    }],
    foundation_world_versions: [{
      workspace_key: workspaceOf(USERS.a.id), collection_id: COLLECTION_A, manifest_digest: DIGEST_A,
      candidate_object_key: `candidates/${workspaceOf(USERS.a.id)}/${COLLECTION_A}/candidate.json`,
      world_state_id: "world-state-shadow-a", core_output_sha256: DIGEST_A, lifecycle_status: "active",
      first_promoted_at: "2026-11-04T00:00:00.000Z",
    }],
    foundation_api_keys: [],
  };
  const rate = new Map();
  /** Every object-store key or list prefix a route asked for, in order: the tenant boundary on the storage side. */
  const r2 = [];
  const seen = new Map();
  const note = (key) => seen.set(key, (seen.get(key) ?? 0) + 1);

  function filterRows(rows, params) {
    let out = rows;
    for (const [column, raw] of params) {
      if (["select", "order", "limit", "offset"].includes(column)) continue;
      if (column === "or") {
        // PostgREST or=(a.op.v,b.op.v): a row passes when any clause does. Clause values here carry no commas.
        const clauses = raw.replace(/^\(|\)$/g, "").split(",").map((clause) => {
          const [name, ...filter] = clause.split(".");
          return [name, filter.join(".")];
        });
        out = out.filter((row) => clauses.some((clause) => filterRows([row], new URLSearchParams([clause])).length === 1));
        continue;
      }
      const negate = raw.startsWith("not.");
      const [op, ...rest] = (negate ? raw.slice(4) : raw).split(".");
      const value = rest.join(".");
      const like = new RegExp(`^${value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      out = out.filter((row) => negate !== (() => {
        const cell = row[column];
        if (op === "like") return typeof cell === "string" && like.test(cell);
        if (op === "eq") return String(cell) === value;
        if (op === "neq") return String(cell) !== value;
        if (op === "is") return value === "null" ? cell === null || cell === undefined : String(cell) === value;
        if (op === "in") return value.replace(/^\(|\)$/g, "").split(",").includes(String(cell));
        if (op === "gt") return String(cell) > value;
        if (op === "lt") return String(cell) < value;
        return true;
      })());
    }
    const order = params.get("order");
    if (order) {
      const [column, direction] = order.split(",")[0].split(".");
      out = [...out].sort((left, right) => (String(left[column]) < String(right[column]) ? -1 : 1) * (direction === "desc" ? -1 : 1));
    }
    const limit = Number(params.get("limit") ?? "1000");
    return out.slice(0, limit);
  }

  const rpc = {
    create_foundation_api_key_authorized(body) {
      const member = tables.foundation_workspace_members.find((row) => row.workspace_key === body.p_workspace_key && row.user_id === body.p_actor_user_id);
      if (!member || member.authorization_revision !== body.p_authorization_revision) return [400, { message: "api_key_authorization_changed" }];
      const row = {
        key_id: randomUUID(), workspace_key: body.p_workspace_key, name: body.p_name, key_prefix: body.p_key_prefix,
        token_sha256: body.p_token_sha256, scopes: body.p_scopes, expires_at: body.p_expires_at, created_at: now(),
        created_by: body.p_actor_user_id, authorization_revision: body.p_authorization_revision, last_used_at: null, revoked_at: null,
        token_kind: body.p_token_kind ?? "live",
      };
      if (!["live", "mcp"].includes(row.token_kind)) return [400, { message: "foundation_api_keys_token_kind_check" }];
      tables.foundation_api_keys.push(row);
      return [200, row];
    },
    revoke_foundation_api_key_authorized(body) {
      const row = tables.foundation_api_keys.find((key) => key.key_id === body.p_key_id && key.workspace_key === body.p_workspace_key);
      if (!row) return [400, { message: "api_key_not_found" }];
      row.revoked_at ??= now();
      return [200, true];
    },
    // Same contract as migration 0012's function: per key, per scope, per clock minute, at most p_limit.
    consume_foundation_api_rate_limit(body) {
      const minute = new Date().toISOString().slice(0, 16);
      const key = `${body.p_key_id}|${body.p_scope}|${minute}`;
      const used = (rate.get(key) ?? 0) + 1;
      rate.set(key, used);
      return [200, used <= body.p_limit];
    },
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://store");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    const send = (status, value) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(value === undefined ? "" : JSON.stringify(value));
    };
    if (url.pathname.startsWith("/__r2/")) {
      const prefix = url.searchParams.get("prefix");
      const key = decodeURIComponent(url.pathname.slice("/__r2/".length).split("/").slice(1).join("/"));
      r2.push(prefix !== null ? { list: prefix } : { get: key });
      note(prefix !== null ? "R2 LIST" : `R2 ${request.method}`);
      response.writeHead(prefix !== null ? 200 : 404, { "content-type": "application/xml" });
      return response.end(prefix !== null
        ? "<?xml version=\"1.0\" encoding=\"UTF-8\"?><ListBucketResult><IsTruncated>false</IsTruncated><KeyCount>0</KeyCount></ListBucketResult>"
        : "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Error><Code>NoSuchKey</Code></Error>");
    }
    if (url.pathname === "/auth/v1/user") {
      note("GET /auth/v1/user");
      const bearer = (request.headers.authorization ?? "").replace(/^Bearer /, "");
      // A session id from USERS, or the browser fixture's unsigned JWT (e2e/one-path.spec.ts shape) naming a USERS id.
      let sub = null;
      try { sub = JSON.parse(Buffer.from(bearer.split(".")[1] ?? "", "base64url").toString("utf8")).sub ?? null; } catch { sub = null; }
      const user = Object.values(USERS).find((entry) => entry.session === bearer || entry.id === sub);
      return user
        ? send(200, { id: user.id, aud: "authenticated", role: "authenticated", email: `${user.id.slice(0, 8)}@shadow.invalid`, app_metadata: {}, user_metadata: {}, created_at: "2026-11-01T00:00:00Z" })
        : send(401, { message: "invalid JWT" });
    }
    const rpcMatch = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    if (rpcMatch) {
      note(`RPC ${rpcMatch[1]}`);
      const handler = rpc[rpcMatch[1]];
      if (!handler) return send(404, { message: `shadow store: rpc ${rpcMatch[1]} is not implemented` });
      const [status, value] = handler(text ? JSON.parse(text) : {});
      return send(status, value);
    }
    const tableMatch = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    if (tableMatch) {
      const table = tableMatch[1];
      note(`${request.method} ${table}`);
      tables[table] ??= [];
      if (request.method === "GET") return send(200, filterRows(tables[table], url.searchParams));
      if (request.method === "POST") {
        const rows = text ? [JSON.parse(text)].flat() : [];
        tables[table].push(...rows);
        return send(201, rows);
      }
      if (request.method === "PATCH") {
        const patch = text ? JSON.parse(text) : {};
        const rows = filterRows(tables[table], url.searchParams);
        for (const row of rows) Object.assign(row, patch);
        return send(200, rows);
      }
      return send(405, { message: "shadow store: method not implemented" });
    }
    note(`UNHANDLED ${request.method} ${url.pathname}`);
    return send(404, { message: "shadow store: not implemented" });
  });
  return { server, tables, seen, r2 };
}

/* ----------------------------------------------------------------- server */

const ALLOW = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "ComSpec", "PATHEXT"];

export async function startShadow({ cohort, extraEnv = {} } = {}) {
  const store = createStore();
  const workerSecret = randomBytes(32).toString("base64url");
  const storePort = await freePort();
  await new Promise((settle) => store.server.listen(storePort, "127.0.0.1", settle));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(ALLOW.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
  Object.assign(env, {
    NODE_ENV: "production",
    NODE_OPTIONS: `--import ${pathToFileURL(resolve(import.meta.dirname, "loopback-fetch.mjs")).href}`,
    TAVONEL_SHADOW_STORE_ORIGIN: `http://127.0.0.1:${storePort}`,
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "foundation-browser-e2e-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: `shadow-${randomBytes(24).toString("hex")}`,
    FOUNDATION_PILOT_USER_IDS: Object.values(USERS).map((user) => user.id).join(","),
    TAVONEL_REMOTE_MCP_ENABLED: "true",
    TAVONEL_REMOTE_MCP_SIGNING_SECRET: randomBytes(32).toString("base64url"),
    FOUNDATION_WORKER_SECRET: workerSecret,
    TAVONEL_REMOTE_MCP_COHORT: cohort ?? [USERS.a, USERS.b].map((user) => workspaceOf(user.id)).join(","),
    NEXT_TELEMETRY_DISABLED: "1",
    // A synthetic object-store account; loopback-fetch.mjs sends its host to an empty bucket in the store.
    R2_ACCOUNT_ID: "0".repeat(32),
    R2_BUCKET: "tavonel-saas-foundation-quarantine",
    R2_ACCESS_KEY_ID: `shadow${randomBytes(8).toString("hex")}`,
    R2_SECRET_ACCESS_KEY: randomBytes(24).toString("hex"),
    ...extraEnv,
  });
  const lines = [];
  const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: resolve(import.meta.dirname, "../.."), env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  const collect = (chunk) => { for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) lines.push(line); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  let ready = false;
  for (const deadline = Date.now() + 120_000; !ready && Date.now() < deadline;) {
    try { ready = (await fetch(`${base}/api/healthz`)).ok; } catch { /* not yet */ }
    if (!ready) await new Promise((settle) => setTimeout(settle, 500));
  }
  if (!ready) { child.kill(); store.server.close(); throw new Error(`next start did not answer on ${base}:\n${lines.slice(-20).join("\n")}`); }
  // `next start` preloads route entries after ready; wait for three quick answers before measuring.
  for (let quick = 0; quick < 3;) {
    const started = Date.now();
    const ok = await fetch(`${base}/api/healthz`).then((response) => response.ok, () => false);
    if (child.exitCode !== null) throw new Error(`next start exited:\n${lines.slice(-20).join("\n")}`);
    quick = ok && Date.now() - started < 1_500 ? quick + 1 : 0;
  }
  return {
    base, store, lines, workerSecret,
    async stop() { child.kill(); await new Promise((settle) => store.server.close(settle)); },
  };
}

/* ----------------------------------------------------------------- client */

export let connectionResets = 0;
export async function http(base, method, path, { headers = {}, body, form, json } = {}) {
  const init = { method, headers: { ...headers }, redirect: "manual" };
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers["content-type"] = "application/json"; }
  if (form !== undefined) { init.body = new URLSearchParams(form).toString(); init.headers["content-type"] = "application/x-www-form-urlencoded"; }
  if (body !== undefined) init.body = body;
  const started = performance.now();
  /*
    One retry on ECONNRESET, counted. On Windows a pooled keep-alive socket the server has just
    closed resets on reuse before the request is written; the server never saw that request.
  */
  let response;
  try {
    response = await fetch(`${base}${path}`, init);
  } catch (error) {
    if (error?.cause?.code !== "ECONNRESET") throw error;
    connectionResets += 1;
    response = await fetch(`${base}${path}`, init);
  }
  const text = await response.text();
  const ms = performance.now() - started;
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  const pick = ["content-type", "cache-control", "www-authenticate", "allow", "pragma", "mcp-session-id", "access-control-allow-origin"];
  return {
    status: response.status, ms: Math.round(ms * 10) / 10, json: parsed, text,
    headers: Object.fromEntries(pick.filter((name) => response.headers.has(name)).map((name) => [name, response.headers.get(name)])),
  };
}

export const pkce = () => {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** Register, consent as `user`, exchange: the whole OAuth dance a client performs. */
export async function obtainToken(base, user, { redirectUri = "https://claude.ai/api/mcp/auth_callback", clientName = "Shadow client" } = {}) {
  const registration = await http(base, "POST", "/api/mcp/oauth/register", { json: { client_name: clientName, redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] } });
  const clientId = registration.json?.client_id;
  const { verifier, challenge } = pkce();
  const state = randomBytes(12).toString("hex");
  const request = { response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state, resource: `${base}/api/mcp`, scope: "" };
  const approved = await http(base, "POST", "/api/mcp/oauth/authorize", { headers: { authorization: `Bearer ${user.session}` }, json: { decision: "approve", request } });
  const redirect = approved.json?.redirectTo ? new URL(approved.json.redirectTo) : null;
  const code = redirect?.searchParams.get("code") ?? null;
  const token = code ? await http(base, "POST", "/api/mcp/oauth/token", { form: { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource: `${base}/api/mcp` } }) : null;
  return { registration, approved, redirect, code, clientId, verifier, token, accessToken: token?.json?.access_token ?? null };
}

let rpcId = 0;
export function mcp(base, message, token, headers = {}) {
  return http(base, "POST", "/api/mcp", {
    headers: { accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    json: { jsonrpc: "2.0", id: ++rpcId, ...message },
  });
}

/** A developer key written straight into the synthetic store, for the credential shapes OAuth never mints. */
export function plantKey(store, { workspaceKey, userId, scopes, expiresAt = null, revokedAt = null, name = "planted" }) {
  const prefix = randomBytes(9).toString("base64url");
  const token = `tvnl_live_${prefix}_${randomBytes(32).toString("base64url")}`;
  store.tables.foundation_api_keys.push({
    key_id: randomUUID(), workspace_key: workspaceKey, name, key_prefix: prefix, token_sha256: hex(token), scopes,
    expires_at: expiresAt, created_at: new Date().toISOString(), created_by: userId, authorization_revision: 1, last_used_at: null, revoked_at: revokedAt,
    token_kind: "live",
  });
  return token;
}

/** The SLI lines the server printed (lib/remote-mcp.ts recordRemoteMcpSli). */
export const sliLines = (lines) => lines.flatMap((line) => {
  try { const value = JSON.parse(line); return value?.sli === "tavonel.remote_mcp_sli.v1" ? [value] : []; } catch { return []; }
});
export const funnelLines = (lines) => lines.flatMap((line) => {
  try { const value = JSON.parse(line); return typeof value?.event === "string" && value.event.startsWith("mcp_") ? [value] : []; } catch { return []; }
});
export const blockedHosts = (lines) => lines.flatMap((line) => {
  try { const value = JSON.parse(line); return value?.shadowBlockedHost ? [value.shadowBlockedHost] : []; } catch { return []; }
});
