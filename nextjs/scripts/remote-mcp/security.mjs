/**
 * W1-A1.2 benchmark: load and security of the remote MCP against a local `next start`.
 *
 *   node scripts/remote-mcp/security.mjs --out <dir>     (run from nextjs/, after `next build`)
 *
 * Measures: 10 concurrent sessions, the per-key rate limit, token TTL and expiry, revoke
 * immediacy through the product's own revoke route, cross-tenant reads (expected 0), the
 * processing-cohort gate, and the read-only guard. Writes REMOTE-MCP-SECURITY-<sha>.json.
 *
 * The store is synthetic (shadow-common.mjs). What that means for each measurement is written
 * next to it in the receipt: the rate-limit counter is the store's implementation of the RPC's
 * contract, not migration 0012's SQL; expiry is reached by moving the stored expires_at, not by
 * waiting an hour. Everything above the store -- every route, check and refusal -- is the build.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COLLECTION_A, USERS, blockedHosts, connectionResets, funnelLines, http, mcp, obtainToken, plantKey, sha256, sliLines, startShadow, workspaceOf } from "./shadow-common.mjs";

const out = process.argv[process.argv.indexOf("--out") + 1];
if (!process.argv.includes("--out") || !out) throw new Error("usage: node scripts/remote-mcp/security.mjs --out <dir>");
const root = resolve(import.meta.dirname, "../..");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const buildId = readFileSync(join(root, ".next/BUILD_ID"), "utf8").trim();
const results = {};
const call = (base, token, name, args = {}) => mcp(base, { method: "tools/call", params: { name, arguments: args } }, token);
const outcome = (response) => {
  const result = response.json?.result;
  if (!result) return `HTTP_${response.status}:${response.json?.error?.message ?? ""}`;
  if (!result.isError) return "ok";
  const text = String(result.content?.[0]?.text ?? "");
  return text.match(/^(API_ERROR_\d{3}: [A-Z_]+|[A-Z][A-Z0-9_]+)/)?.[0] ?? "TOOL_FAILED";
};
const keyRowFor = (store, accessToken) => {
  const prefix = /^tvnl_live_([A-Za-z0-9_-]{12})_/.exec(accessToken ?? "")?.[1];
  return store.tables.foundation_api_keys.find((row) => row.key_prefix === prefix);
};

const shadow = await startShadow();
const { base, store } = shadow;
try {
  /* ---------------------------------------------------- 10 concurrent sessions */
  const sessions = [];
  for (let index = 0; index < 10; index += 1) {
    const user = index < 5 ? USERS.a : USERS.b;
    const flow = await obtainToken(base, user, { clientName: `Load ${index}` });
    sessions.push({ index, workspace: workspaceOf(user.id), token: flow.accessToken });
  }
  const startedAll = performance.now();
  const perSession = await Promise.all(sessions.map(async (session) => {
    const steps = [];
    steps.push(await mcp(base, { method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: `load-${session.index}`, version: "1" } } }, session.token));
    steps.push(await mcp(base, { method: "tools/list" }, session.token));
    const worlds = [];
    for (let round = 0; round < 3; round += 1) {
      const response = await call(base, session.token, "list_worlds", {});
      steps.push(response);
      const text = response.json?.result?.content?.[0]?.text;
      try { worlds.push(JSON.parse(text).collections.map((entry) => entry.collectionId)); } catch { worlds.push(null); }
    }
    const foreign = await call(base, session.token, "get_world", { collectionId: COLLECTION_A });
    steps.push(foreign);
    return {
      session: session.index, workspace: session.workspace,
      statuses: steps.map((step) => step.status), ms: steps.map((step) => step.ms),
      worldsSeen: worlds, getWorldA: outcome(foreign),
    };
  }));
  const wallMs = Math.round(performance.now() - startedAll);
  const leaks = perSession.filter((entry) => entry.workspace !== workspaceOf(USERS.a.id)
    && (entry.worldsSeen.some((list) => list?.includes(COLLECTION_A)) || entry.getWorldA === "ok"));
  results.concurrency = {
    sessions: 10, workspaces: { A: 5, B: 5 }, requestsPerSession: 6, wallMs, perSession,
    nonOkHttp: perSession.flatMap((entry) => entry.statuses).filter((status) => status !== 200).length,
    crossTenantLeaks: leaks.length,
    pass: leaks.length === 0 && perSession.every((entry) => entry.statuses.every((status) => status === 200)
      && entry.worldsSeen.every((list) => JSON.stringify(list) === JSON.stringify(entry.workspace === workspaceOf(USERS.a.id) ? [COLLECTION_A] : []))),
  };

  /* ------------------------------------------------------------- rate limit */
  const limited = await obtainToken(base, USERS.a, { clientName: "Rate" });
  const second = new Date().getSeconds();
  if (second > 45) await new Promise((settle) => setTimeout(settle, (61 - second) * 1000));
  const minute = new Date().toISOString().slice(0, 16);
  const rateOutcomes = [];
  for (let index = 0; index < 31; index += 1) rateOutcomes.push(outcome(await call(base, limited.accessToken, "search_world", { collectionId: COLLECTION_A, query: "notice period" })));
  const limitedAt = rateOutcomes.findIndex((entry) => entry === "API_ERROR_429: API_RATE_LIMITED");
  const otherScope = outcome(await call(base, limited.accessToken, "list_worlds", {}));
  results.rateLimit = {
    scope: "ask:read", limitPerMinute: 30, clockMinute: minute, calls: 31,
    firstLimitedCall: limitedAt + 1, outcomes: rateOutcomes.reduce((counts, entry) => ({ ...counts, [entry]: (counts[entry] ?? 0) + 1 }), {}),
    otherScopeSameKeyAfter: otherScope,
    synthetic: "the counter is the synthetic store's implementation of consume_foundation_api_rate_limit's contract (per key, per scope, per clock minute); the 429 mapping and the per-call spend are the build's",
    pass: limitedAt === 30 && otherScope === "ok",
  };

  /* --------------------------------------------------------------- TTL, expiry */
  const ttl = await obtainToken(base, USERS.a, { clientName: "TTL" });
  const row = keyRowFor(store, ttl.accessToken);
  const lifetimeSeconds = row ? Math.round((Date.parse(row.expires_at) - Date.parse(row.created_at)) / 1000) : null;
  const beforeExpiry = outcome(await call(base, ttl.accessToken, "list_worlds", {}));
  if (row) row.expires_at = new Date(Date.now() - 1_000).toISOString();
  const afterExpiry = await call(base, ttl.accessToken, "list_worlds", {});
  results.tokenTtl = {
    expiresIn: ttl.token?.json?.expires_in, storedKeyLifetimeSeconds: lifetimeSeconds, refreshTokenIssued: "refresh_token" in (ttl.token?.json ?? {}),
    beforeExpiry, afterExpiry: { status: afterExpiry.status, challenge: afterExpiry.headers["www-authenticate"] },
    synthetic: "expiry reached by moving the stored expires_at one second into the past, not by waiting 3600 s",
    pass: ttl.token?.json?.expires_in === 3600 && lifetimeSeconds !== null && Math.abs(lifetimeSeconds - 3600) <= 2 && beforeExpiry === "ok"
      && afterExpiry.status === 401 && /expired/.test(afterExpiry.headers["www-authenticate"] ?? ""),
  };

  /* ------------------------------------------------------- revoke immediacy */
  const revocable = await obtainToken(base, USERS.a, { clientName: "Revoke" });
  const revRow = keyRowFor(store, revocable.accessToken);
  const beforeRevoke = outcome(await call(base, revocable.accessToken, "list_worlds", {}));
  const revoke = await http(base, "DELETE", `/api/developer/keys/${revRow?.key_id}`, { headers: { authorization: `Bearer ${USERS.a.session}` } });
  const revokedAt = performance.now();
  const afterRevoke = await call(base, revocable.accessToken, "list_worlds", {});
  results.revoke = {
    route: "DELETE /api/developer/keys/{id} with the workspace owner's session (the product's own revoke)",
    revokeStatus: revoke.status, beforeRevoke, firstCallAfter: { status: afterRevoke.status, msAfterRevokeResponse: Math.round(performance.now() - revokedAt) },
    callsAllowedAfterRevoke: afterRevoke.status === 401 ? 0 : 1,
    pass: beforeRevoke === "ok" && revoke.status === 204 && afterRevoke.status === 401,
  };

  /* ------------------------------------------------------------ cross-tenant */
  const tokenB = (await obtainToken(base, USERS.b, { clientName: "Tenant B" })).accessToken;
  const scoped = {
    get_world: { collectionId: COLLECTION_A }, search_world: { collectionId: COLLECTION_A, query: "notice" },
    ask_world: { collectionId: COLLECTION_A, question: "What is the notice period?" }, get_object: { collectionId: COLLECTION_A },
    get_relation: { collectionId: COLLECTION_A }, get_evidence: { collectionId: COLLECTION_A, limit: 5 }, download_package: { collectionId: COLLECTION_A },
  };
  const crossTenant = [];
  const r2Before = store.r2.length;
  for (const [tool, args] of Object.entries(scoped)) {
    const response = await call(base, tokenB, tool, args);
    const text = JSON.stringify(response.json?.result ?? {});
    crossTenant.push({ tool, outcome: outcome(response), leaked: response.json?.result?.isError === false || text.includes("world-state-shadow-a") || text.includes(`"d${"d".repeat(10)}`) });
  }
  const listB = await call(base, tokenB, "list_worlds", {});
  // Every object-store key or prefix B's calls asked for must be under B's own workspace.
  const r2DuringB = store.r2.slice(r2Before);
  const r2Foreign = r2DuringB.filter((entry) => String(entry.list ?? entry.get).includes(workspaceOf(USERS.a.id)));
  const tokenA = (await obtainToken(base, USERS.a, { clientName: "Tenant A" })).accessToken;
  const ownWorld = outcome(await call(base, tokenA, "get_world", { collectionId: COLLECTION_A }));
  results.crossTenant = {
    attempts: crossTenant.length + 1, calls: crossTenant,
    listWorldsB: JSON.parse(listB.json?.result?.content?.[0]?.text ?? "{}").collections ?? null,
    sameCallFromOwner: { get_world: ownWorld, note: "A reads past the tenant check to the object store, which the shadow does not provide; B is refused before it" },
    objectStoreRequestsDuringB: r2DuringB,
    objectStoreRequestsUnderA: r2Foreign.length,
    leaks: crossTenant.filter((entry) => entry.leaked).length + r2Foreign.length,
    // The refusal must come from B's own tenant lookup (404/409), not from a missing dependency.
    pass: crossTenant.every((entry) => !entry.leaked && /404|409/.test(entry.outcome)) && r2Foreign.length === 0,
  };

  /* --------------------------------------------------------- processing cohort */
  const excludedFlow = await obtainToken(base, USERS.c, { clientName: "Outside cohort" });
  const plantedC = plantKey(store, { workspaceKey: workspaceOf(USERS.c.id), userId: USERS.c.id, scopes: ["ask:read", "collections:download", "collections:read", "documents:read", "worlds:read"] });
  const excludedCall = await call(base, plantedC, "list_worlds", {});
  results.cohort = {
    consent: { status: excludedFlow.approved.status, code: excludedFlow.approved.json?.code },
    callWithLiveKey: { status: excludedCall.status, code: excludedCall.json?.error?.message },
    pass: excludedFlow.approved.status === 403 && excludedFlow.approved.json?.code === "PROCESSING_COHORT_EXCLUDED" && excludedCall.status === 403,
  };

  /* --------------------------------------------------------- read-only guard */
  const writer = plantKey(store, { workspaceKey: workspaceOf(USERS.a.id), userId: USERS.a.id, scopes: ["worlds:read", "connections:write"] });
  const writerCall = await call(base, writer, "list_worlds", {});
  const narrow = plantKey(store, { workspaceKey: workspaceOf(USERS.a.id), userId: USERS.a.id, scopes: ["worlds:read"] });
  const narrowCall = await call(base, narrow, "ask_world", { collectionId: COLLECTION_A, question: "What is the notice period?" });
  const unknownTool = outcome(await call(base, tokenA, "promote_world", { collectionId: COLLECTION_A }));
  const listed = (await mcp(base, { method: "tools/list" }, tokenA)).json?.result?.tools?.map((tool) => tool.name) ?? [];
  const unit = spawnSync(process.execPath, [resolve(root, "node_modules/vitest/vitest.mjs"), "run", "lib/remote-mcp.test.ts", "-t", "write tool"], { cwd: root, encoding: "utf8", timeout: 300_000, env: { ...process.env, FORCE_COLOR: "0" } });
  // eslint-disable-next-line no-control-regex
  const unitSummary = (unit.stdout.replace(/\u001b\[[0-9;]*m/g, "").match(/Tests\s+[^\n]+/) ?? [""])[0].trim();
  results.readOnly = {
    writeScopedToken: { status: writerCall.status, challenge: writerCall.headers["www-authenticate"] },
    tokenWithoutScope: { status: narrowCall.status, challenge: narrowCall.headers["www-authenticate"] },
    unknownWriteTool: unknownTool,
    toolsListed: listed,
    writeToolsListed: listed.filter((name) => /upload|compile|promote|activate|rollback|delete|write|create|update|sync|revoke/.test(name)),
    startupRefusalUnitTest: { command: "vitest run lib/remote-mcp.test.ts -t 'write tool'", exit: unit.status, summary: unitSummary },
    pass: writerCall.status === 401 && /write scope/.test(writerCall.headers["www-authenticate"] ?? "") && narrowCall.status === 403
      && unknownTool.startsWith("TOOL_NOT_FOUND") && listed.length === 9 && unit.status === 0,
  };

  /* -------------------------------------------------------------------- SLI */
  const sli = sliLines(shadow.lines);
  const sorted = sli.map((line) => line.durationMs).sort((left, right) => left - right);
  const rank = (p) => (sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null);
  const http5xx = sli.filter((line) => line.status >= 500).length;
  const server5xx = sli.filter((line) => line.status >= 500 || (line.upstreamStatus ?? 0) >= 500).length;
  results.sli = {
    source: "tavonel.remote_mcp_sli.v1 lines the server printed during this run (lib/remote-mcp.ts summarizeRemoteMcpSli's definition)",
    calls: sli.length, p50Ms: rank(0.5), p95Ms: rank(0.95), http5xx, server5xx, server5xxRatio: sli.length ? server5xx / sli.length : null,
    byStatus: sli.reduce((counts, line) => ({ ...counts, [line.status]: (counts[line.status] ?? 0) + 1 }), {}),
    note: "a local machine with a synthetic store: latency here says nothing about production, and the upstream 5xx here are the shadow's missing object store and retrieval runtime (SIGNER/BINDING/LIST codes), not product faults; a regression baseline for this harness only",
  };
  results.funnel = funnelLines(shadow.lines).reduce((counts, line) => {
    const key = line.event === "mcp_tool_failed" ? `${line.event}{${line.code}}` : line.event;
    return { ...counts, [key]: (counts[key] ?? 0) + 1 };
  }, {});

  const receipt = {
    schemaVersion: "tavonel.remote_mcp_security.v1",
    ladderStep: "W1-A1.2 benchmark",
    generatedAt: new Date().toISOString(),
    commit, buildId,
    harness: Object.fromEntries(["shadow-common.mjs", "security.mjs", "loopback-fetch.mjs"].map((name) => [name, sha256(readFileSync(join(import.meta.dirname, name)))])),
    environment: {
      server: "next start of the local production build, TAVONEL_REMOTE_MCP_ENABLED=true, pilot cohort = workspaces A and B (C is a pilot member outside it)",
      store: "SYNTHETIC (scripts/remote-mcp/shadow-common.mjs): in-memory PostgREST, /auth/v1/user, an empty R2 bucket that logs every key and prefix asked for; no retrieval runtime",
      blockedOutboundHosts: [...new Set(blockedHosts(shadow.lines))],
      clientConnectionResetsRetried: connectionResets,
    },
    independentSecurityReview: "NOT ATTACHED. The program requires one; this lane implemented the code and cannot review it.",
    summary: {
      crossTenantLeaks: results.concurrency.crossTenantLeaks + results.crossTenant.leaks,
      writePaths: results.readOnly.writeToolsListed.length + (results.readOnly.writeScopedToken.status === 401 ? 0 : 1),
      pass: Object.fromEntries(Object.entries(results).filter(([, value]) => typeof value?.pass === "boolean").map(([key, value]) => [key, value.pass])),
    },
    results,
  };
  mkdirSync(out, { recursive: true });
  const path = join(out, `REMOTE-MCP-SECURITY-${commit.slice(0, 12)}.json`);
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ path, ...receipt.summary, sli: { calls: results.sli.calls, p50Ms: results.sli.p50Ms, p95Ms: results.sli.p95Ms, server5xxRatio: results.sli.server5xxRatio } }, null, 2));
} finally {
  await shadow.stop();
}
