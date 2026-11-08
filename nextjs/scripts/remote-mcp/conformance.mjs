/**
 * W1-A1.1 shadow: OAuth discovery, registration, PKCE, resource indicators and the nine tools,
 * against a local `next start` of the current build with TAVONEL_REMOTE_MCP_ENABLED=true.
 *
 *   node scripts/remote-mcp/conformance.mjs --out <dir>     (run from nextjs/, after `next build`)
 *
 * Writes REMOTE-MCP-CONFORMANCE-<sha>.json: every request's status and headers, the tools/list and
 * tools/call transcripts with sha256 per message, and a pass/fail per check. Each check states the
 * spec clause it reads. Real clients (Claude, ChatGPT) are NOT exercised here; the receipt lists
 * the handshake the code produces for them to be compared against.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { COLLECTION_A, USERS, blockedHosts, connectionResets, funnelLines, http, mcp, obtainToken, pkce, sha256, sliLines, startShadow } from "./shadow-common.mjs";

const out = process.argv[process.argv.indexOf("--out") + 1];
if (!process.argv.includes("--out") || !out) throw new Error("usage: node scripts/remote-mcp/conformance.mjs --out <dir>");
const root = resolve(import.meta.dirname, "../..");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const buildId = readFileSync(join(root, ".next/BUILD_ID"), "utf8").trim();

const checks = [];
const check = (name, spec, pass, observed) => { checks.push({ name, spec, pass: Boolean(pass), observed }); };
const exchanges = [];
const record = (label, request, response) => {
  exchanges.push({ label, request, status: response.status, headers: response.headers, ms: response.ms, bodySha256: sha256(response.text) });
  return response;
};

const shadow = await startShadow();
const { base } = shadow;
try {
  /* -------------------------------------------------------------- discovery */
  const anonymousCall = record("tools/call without a token", { method: "POST", path: "/api/mcp" },
    await mcp(base, { method: "tools/call", params: { name: "list_worlds", arguments: {} } }));
  check("401 names the RFC 9728 document", "MCP 2025-06-18 Authorization §2.3.1; RFC 9728 §5.1",
    anonymousCall.status === 401 && anonymousCall.headers["www-authenticate"] === `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/api/mcp"`,
    anonymousCall.headers["www-authenticate"]);

  const prm = record("RFC 9728 path-suffixed", { method: "GET", path: "/.well-known/oauth-protected-resource/api/mcp" },
    await http(base, "GET", "/.well-known/oauth-protected-resource/api/mcp"));
  check("RFC 9728 document at the path-suffixed URL", "RFC 9728 §3.1, §3.2",
    prm.status === 200 && prm.json?.resource === `${base}/api/mcp` && prm.json?.authorization_servers?.[0] === base, prm.json);
  const prmRoot = record("RFC 9728 root", { method: "GET", path: "/.well-known/oauth-protected-resource" },
    await http(base, "GET", "/.well-known/oauth-protected-resource"));
  check("RFC 9728 document at the bare URL clients fall back to", "RFC 9728 §3.1 (ChatGPT documents the bare URL)",
    prmRoot.status === 200 && prmRoot.json?.resource === `${base}/api/mcp`, prmRoot.status);

  const asm = record("RFC 8414", { method: "GET", path: "/.well-known/oauth-authorization-server" },
    await http(base, "GET", "/.well-known/oauth-authorization-server"));
  check("RFC 8414 metadata: issuer is the origin, S256 advertised, registration endpoint, iss parameter", "RFC 8414 §2, §3.3; RFC 9207 §3",
    asm.status === 200 && asm.json?.issuer === base && asm.json?.code_challenge_methods_supported?.includes("S256")
      && asm.json?.registration_endpoint === `${base}/api/mcp/oauth/register` && asm.json?.authorization_response_iss_parameter_supported === true,
    asm.json);
  const oidc = record("OpenID configuration (fallback some clients try)", { method: "GET", path: "/.well-known/openid-configuration" },
    await http(base, "GET", "/.well-known/openid-configuration"));
  check("OIDC discovery is absent, not wrong", "MCP 2025-06-18 uses RFC 8414; OIDC is optional", oidc.status === 404, oidc.status);

  /* ----------------------------------------------------------- registration */
  const redirectUris = {
    claude: "https://claude.ai/api/mcp/auth_callback",
    chatgpt: "https://chatgpt.com/connector_platform_oauth_redirect",
    loopback: "http://127.0.0.1:33418/callback",
  };
  for (const [client, uri] of Object.entries(redirectUris)) {
    const registered = record(`RFC 7591 register (${client} redirect)`, { method: "POST", path: "/api/mcp/oauth/register", redirect_uris: [uri] },
      await http(base, "POST", "/api/mcp/oauth/register", { json: { client_name: `${client} shadow`, redirect_uris: [uri], token_endpoint_auth_method: "none" } }));
    check(`registers a public client with the ${client} redirect URI`, "RFC 7591 §3.2.1",
      registered.status === 201 && registered.json?.token_endpoint_auth_method === "none" && registered.json?.redirect_uris?.[0] === uri,
      { status: registered.status, grant_types: registered.json?.grant_types });
  }
  const confidential = await http(base, "POST", "/api/mcp/oauth/register", { json: { redirect_uris: [redirectUris.claude], token_endpoint_auth_method: "client_secret_basic" } });
  check("refuses a confidential client registration", "RFC 7591 §3.2.2 (invalid_client_metadata)", confidential.status === 400 && confidential.json?.error === "invalid_client_metadata", confidential.json?.error);

  /* -------------------------------------------------- authorization + PKCE */
  const flow = await obtainToken(base, USERS.a, { redirectUri: redirectUris.claude, clientName: "Claude shadow" });
  record("consent approve (session A)", { method: "POST", path: "/api/mcp/oauth/authorize", decision: "approve" }, flow.approved);
  check("approve returns a code to the registered redirect URI with state and iss", "OAuth 2.1 §4.1.2; RFC 9207 §2",
    flow.redirect?.origin + flow.redirect?.pathname === redirectUris.claude && flow.redirect?.searchParams.get("iss") === base
      && Boolean(flow.redirect?.searchParams.get("state")) && /^tvmcp_code_/.test(flow.code ?? ""),
    flow.redirect ? [...flow.redirect.searchParams.keys()].sort() : null);
  record("token exchange (A)", { method: "POST", path: "/api/mcp/oauth/token", resource: "present" }, flow.token);
  check("token response: Bearer, 3600 s, read scopes, no-store, no refresh token", "OAuth 2.1 §3.2.3; RFC 6749 §5.1",
    flow.token?.status === 200 && flow.token.json?.token_type === "Bearer" && flow.token.json?.expires_in === 3600
      && flow.token.json?.scope === "ask:read collections:download collections:read documents:read worlds:read"
      && !("refresh_token" in (flow.token.json ?? {})) && flow.token.headers["cache-control"] === "no-store",
    { status: flow.token?.status, keys: Object.keys(flow.token?.json ?? {}).sort(), cacheControl: flow.token?.headers["cache-control"] });

  const register = async () => (await http(base, "POST", "/api/mcp/oauth/register", { json: { client_name: "Negative", redirect_uris: [redirectUris.claude] } })).json.client_id;
  const describe = async (clientId, extra) => {
    const { challenge } = pkce();
    return http(base, "POST", "/api/mcp/oauth/authorize", { json: { decision: "describe", request: {
      response_type: "code", client_id: clientId, redirect_uri: redirectUris.claude, code_challenge: challenge, code_challenge_method: "S256",
      state: "s", resource: `${base}/api/mcp`, ...extra } } });
  };
  const negClient = await register();
  for (const [label, extra, error] of [
    ["PKCE plain refused", { code_challenge_method: "plain" }, "invalid_request"],
    ["PKCE missing refused", { code_challenge: undefined, code_challenge_method: undefined }, "invalid_request"],
    ["foreign resource refused", { resource: "https://elsewhere.example/mcp" }, "invalid_target"],
    ["write scope refused", { scope: "connections:write" }, "invalid_scope"],
  ]) {
    const response = await describe(negClient, extra);
    const back = response.json?.redirectTo ? new URL(response.json.redirectTo) : null;
    check(label, "OAuth 2.1 §4.1.1, §7.5.2; RFC 8707 §2", back?.searchParams.get("error") === error && !back?.searchParams.has("code"), back?.searchParams.get("error"));
  }

  const second = await obtainToken(base, USERS.a, { redirectUri: redirectUris.chatgpt, clientName: "ChatGPT shadow" });
  const wrongVerifier = await http(base, "POST", "/api/mcp/oauth/token", { form: { grant_type: "authorization_code", code: second.code ?? "", client_id: second.clientId, code_verifier: `${second.verifier}x` } });
  check("wrong PKCE verifier is invalid_grant", "OAuth 2.1 §4.1.3", second.token?.status === 200 && wrongVerifier.json?.error === "invalid_grant", wrongVerifier.json?.error);
  const third = await obtainToken(base, USERS.a);
  const replay = await http(base, "POST", "/api/mcp/oauth/token", { form: { grant_type: "authorization_code", code: third.code ?? "", client_id: third.clientId, code_verifier: third.verifier, resource: `${base}/api/mcp` } });
  const revokedByReplay = await mcp(base, { method: "tools/call", params: { name: "list_worlds", arguments: {} } }, third.accessToken);
  check("a code redeemed twice is refused and the first token is revoked", "OAuth 2.1 §4.1.3",
    replay.json?.error === "invalid_grant" && revokedByReplay.status === 401, { replay: replay.json?.error, firstTokenAfter: revokedByReplay.status });
  const resourceMismatch = await (async () => {
    const flowR = await obtainToken(base, USERS.a, { redirectUri: redirectUris.loopback });
    return flowR;
  })();
  check("token exchange with the matching resource indicator succeeds", "RFC 8707 §2.2", resourceMismatch.token?.status === 200, resourceMismatch.token?.status);

  /* ------------------------------------------------------------- transport */
  const token = flow.accessToken;
  const init = record("initialize", { method: "initialize", protocolVersion: "2025-06-18" },
    await mcp(base, { method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "shadow", version: "1" } } }, token));
  check("initialize answers 2025-06-18 as application/json", "MCP 2025-06-18 lifecycle; Streamable HTTP §2.1",
    init.status === 200 && init.json?.result?.protocolVersion === "2025-06-18" && init.headers["content-type"]?.startsWith("application/json"), init.json?.result?.serverInfo);
  const newer = await mcp(base, { method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "shadow", version: "1" } } }, token, { "mcp-protocol-version": "2025-06-18" });
  check("a client proposing 2025-11-25 is answered with 2025-06-18 (version negotiation, not a refusal)", "MCP lifecycle: version negotiation",
    newer.status === 200 && newer.json?.result?.protocolVersion === "2025-06-18", newer.json?.result?.protocolVersion);
  const newerHeader = await mcp(base, { method: "tools/list" }, token, { "mcp-protocol-version": "2025-11-25" });
  check("MCP-Protocol-Version 2025-11-25 on a request is refused with 400 (only 2025-06-18 and 2025-03-26 are served)", "MCP 2025-06-18 Streamable HTTP §2.7",
    newerHeader.status === 400, newerHeader.status);
  const noHeader = await http(base, "POST", "/api/mcp", { headers: { accept: "application/json, text/event-stream" }, json: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  check("no MCP-Protocol-Version header is accepted (assumed 2025-03-26)", "MCP 2025-06-18 Streamable HTTP §2.7", noHeader.status === 200, noHeader.status);
  const notification = await http(base, "POST", "/api/mcp", { headers: { accept: "application/json, text/event-stream", authorization: `Bearer ${token}` }, json: { jsonrpc: "2.0", method: "notifications/initialized" } });
  check("a notification is 202 with no body", "Streamable HTTP §2.1.4", notification.status === 202 && notification.text === "", notification.status);
  const getStream = record("GET /api/mcp (SSE stream)", { method: "GET", path: "/api/mcp" }, await http(base, "GET", "/api/mcp", { headers: { accept: "text/event-stream" } }));
  check("GET answers 405 (no server-initiated stream)", "Streamable HTTP §2.2.3", getStream.status === 405 && getStream.headers.allow === "POST", getStream.headers);
  const deleteSession = record("DELETE /api/mcp (session end)", { method: "DELETE", path: "/api/mcp" }, await http(base, "DELETE", "/api/mcp"));
  check("DELETE is refused (no Mcp-Session-Id is ever issued)", "Streamable HTTP §2.5.5 (server MAY 405)", deleteSession.status === 405, deleteSession.status);
  check("no Mcp-Session-Id header on initialize", "Streamable HTTP §2.5.1 (session id is optional)", !("mcp-session-id" in init.headers), Object.keys(init.headers));
  const foreignOrigin = await mcp(base, { method: "tools/list" }, token, { origin: "https://attacker.example" });
  check("a foreign browser Origin is 403", "Streamable HTTP §2.0.1 (servers MUST validate Origin)", foreignOrigin.status === 403, foreignOrigin.status);

  /* --------------------------------------------------------------- the tools */
  const list = await mcp(base, { method: "tools/list" }, token);
  const tools = list.json?.result?.tools ?? [];
  const listTranscript = { request: { method: "tools/list" }, responseSha256: sha256(list.text), toolNames: tools.map((tool) => tool.name) };
  check("tools/list is exactly the nine read-only tools", "W1-A1 contract",
    JSON.stringify(listTranscript.toolNames) === JSON.stringify(["list_sources", "list_worlds", "get_world", "search_world", "ask_world", "get_object", "get_relation", "get_evidence", "download_package"])
      && tools.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false), listTranscript.toolNames);
  const args = {
    list_sources: {}, list_worlds: {}, get_world: { collectionId: COLLECTION_A },
    search_world: { collectionId: COLLECTION_A, query: "notice period" }, ask_world: { collectionId: COLLECTION_A, question: "What is the notice period?" },
    get_object: { collectionId: COLLECTION_A }, get_relation: { collectionId: COLLECTION_A }, get_evidence: { collectionId: COLLECTION_A, limit: 5 },
    download_package: { collectionId: COLLECTION_A },
  };
  const calls = [];
  for (const tool of tools) {
    const request = { method: "tools/call", params: { name: tool.name, arguments: args[tool.name] ?? {} } };
    const response = await mcp(base, request, token);
    const result = response.json?.result;
    calls.push({
      tool: tool.name, request, requestSha256: sha256(JSON.stringify(request)), httpStatus: response.status, ms: response.ms,
      responseSha256: sha256(response.text), isError: result?.isError ?? null,
      // The leading constant only: what the route said, never the payload.
      outcome: result?.isError ? String(result.content?.[0]?.text ?? "").split(/\s/)[0] + " " + (String(result.content?.[0]?.text ?? "").match(/: ([A-Z_]+)/)?.[1] ?? "")
        : "ok",
      structured: Boolean(result?.structuredContent),
    });
  }
  check("every tools/call is answered as a JSON-RPC result (a tool failure is a result, not a protocol error)", "MCP 2025-06-18 tools §5",
    calls.length === 9 && calls.every((entry) => entry.httpStatus === 200 && entry.isError !== null), calls.map((entry) => [entry.tool, entry.outcome]));
  const worlds = calls.find((entry) => entry.tool === "list_worlds");
  check("list_worlds reads workspace A's one active World through the remote endpoint", "tenant-scoped read", worlds?.outcome === "ok", worlds?.outcome);

  const receipt = {
    schemaVersion: "tavonel.remote_mcp_conformance.v1",
    ladderStep: "W1-A1.1 shadow",
    generatedAt: new Date().toISOString(),
    commit, buildId,
    harness: Object.fromEntries(["shadow-common.mjs", "conformance.mjs", "loopback-fetch.mjs"].map((name) => [name, sha256(readFileSync(join(import.meta.dirname, name)))])),
    environment: {
      server: "next start of the local production build (NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co fixture), TAVONEL_REMOTE_MCP_ENABLED=true, throwaway sealing secret",
      store: "SYNTHETIC (scripts/remote-mcp/shadow-common.mjs): in-memory PostgREST, /auth/v1/user, an empty R2 bucket; no retrieval runtime",
      productionSecrets: "none read; allowlisted env; non-loopback fetch refused",
      blockedOutboundHosts: [...new Set(blockedHosts(shadow.lines))],
      clientConnectionResetsRetried: connectionResets,
      cohort: "pilot cohort = workspaces A and B",
    },
    realClients: {
      claude: "NOT TESTED. A Claude custom connector connects from Anthropic's cloud and needs a public https URL; no tunnel was opened and no claude.ai account was used.",
      chatgpt: "NOT TESTED. Same reason (ChatGPT connects from OpenAI's cloud; developer mode or a Secure MCP Tunnel needed).",
      handshakeTheCodeProduces: [
        "POST /api/mcp tools/call without a token -> 401, WWW-Authenticate: Bearer resource_metadata=\"<origin>/.well-known/oauth-protected-resource/api/mcp\"",
        "GET that URL (or the bare /.well-known/oauth-protected-resource) -> 200 {resource:<origin>/api/mcp, authorization_servers:[<origin>], scopes_supported:[5 read scopes], bearer_methods_supported:[header]}",
        "GET /.well-known/oauth-authorization-server -> 200 {issuer:<origin>, authorization_endpoint:/oauth/authorize, token_endpoint:/api/mcp/oauth/token, registration_endpoint:/api/mcp/oauth/register, code_challenge_methods_supported:[S256], token_endpoint_auth_methods_supported:[none], grant_types_supported:[authorization_code], authorization_response_iss_parameter_supported:true}",
        "POST /api/mcp/oauth/register (RFC 7591, public client) -> 201 with a sealed client_id; no client secret",
        "Browser: /oauth/authorize?response_type=code&client_id&redirect_uri&code_challenge&code_challenge_method=S256&state&resource -> person signs in and clicks Allow -> redirect_uri?code&state&iss",
        "POST /api/mcp/oauth/token (form) grant_type=authorization_code&code&client_id&code_verifier[&redirect_uri][&resource] -> 200 {access_token, token_type:Bearer, expires_in:3600, scope}; no refresh_token",
        "POST /api/mcp with Authorization: Bearer <token>, MCP-Protocol-Version 2025-06-18 (or none) -> one application/json body per message; GET 405; DELETE 405; no Mcp-Session-Id",
      ],
      knownRisksFromVendorDocs: [
        "No refresh token: both clients will ask the person to reconnect every hour.",
        "ChatGPT deep research / company knowledge expect tools named search and fetch (developers.openai.com/api/docs/mcp); not offered. Developer mode acceptance of arbitrary tools was not confirmed from docs.",
        "ChatGPT prefers Client ID Metadata Documents and links the 2025-11-25 auth spec; DCR is documented as still supported.",
        "A request carrying MCP-Protocol-Version 2025-11-25 is refused 400 (measured above); a client that negotiates honestly on initialize receives 2025-06-18.",
      ],
    },
    checks,
    passed: checks.filter((entry) => entry.pass).length,
    total: checks.length,
    exchanges,
    transcripts: { toolsList: listTranscript, toolsCall: calls },
    storeCalls: Object.fromEntries(shadow.store.seen),
    telemetry: { sliLines: sliLines(shadow.lines).length, funnel: funnelLines(shadow.lines).reduce((counts, line) => ({ ...counts, [line.event]: (counts[line.event] ?? 0) + 1 }), {}) },
  };
  mkdirSync(out, { recursive: true });
  const path = join(out, `REMOTE-MCP-CONFORMANCE-${commit.slice(0, 12)}.json`);
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ path, passed: receipt.passed, total: receipt.total, failed: checks.filter((entry) => !entry.pass).map((entry) => entry.name) }, null, 2));
} finally {
  await shadow.stop();
}
