#!/usr/bin/env node
/**
 * Read-only Paddle reconciliation for an operator (WO-D24-5).
 *
 *   node --experimental-strip-types scripts/billing/paddle-reconcile.mjs prices|transactions [--since <iso>] [--json] [--production]
 *
 * Reads Paddle through lib/paddle-api.ts and the credit ledger through lib/paddle-reconciliation.ts, then
 * prints the delta those pure functions compute. It never writes, never prints an amount, an email, custom
 * data or a key: ids, codes and counts only. The key is read from the environment at run time and nowhere else.
 *
 * Sandbox only (PADDLE_SANDBOX=true) unless --production, which also needs PADDLE_SANDBOX unset and
 * TAVONEL_RECONCILE_PRODUCTION_CONFIRM=READ-ONLY.
 *
 * Exit 0: empty delta. 1: non-empty delta, or a window the page cap truncated (agreement is not proven).
 * 2: not configured, refused, or bad arguments. 3: a read failed (fail closed, never read as agreement).
 */

import "../router/register-ts-loader.mjs";
import { pathToFileURL } from "node:url";

export const RECONCILE_SCHEMA = "tavonel.paddle_reconcile.v1";
const DEFAULT_WINDOW_DAYS = 7;
const NO_KEY = "PADDLE_API_KEY is not configured for this environment";

async function loadDeps() {
  const [api, rec, catalog] = await Promise.all([
    import("../../lib/paddle-api.ts"),
    import("../../lib/paddle-reconciliation.ts"),
    import("../../lib/billing-catalog.ts"),
  ]);
  return { ...api, ...rec, BILLING_OFFERS: catalog.BILLING_OFFERS };
}

export function parseArgs(argv, now = new Date()) {
  const [command, ...rest] = argv;
  if (command !== "prices" && command !== "transactions") {
    return { error: "usage: prices|transactions [--since <iso>] [--json] [--production]" };
  }
  const args = {
    command,
    json: false,
    production: false,
    since: new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString(),
  };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--json") args.json = true;
    else if (rest[i] === "--production") args.production = true;
    else if (rest[i] === "--since") {
      const ms = Date.parse(rest[++i] ?? "");
      if (!Number.isFinite(ms)) return { error: "--since needs an ISO-8601 instant" };
      args.since = new Date(ms).toISOString();
    } else return { error: `unknown argument ${rest[i]}` };
  }
  return args;
}

/** Null when the environment may be read; otherwise the refusal. */
export function environmentRefusal(args, env) {
  const sandbox = env.PADDLE_SANDBOX === "true";
  if (!args.production) return sandbox ? null : "refused: sandbox only; set PADDLE_SANDBOX=true or pass --production";
  if (env.PADDLE_SANDBOX !== undefined) return "refused: --production needs PADDLE_SANDBOX unset";
  return env.TAVONEL_RECONCILE_PRODUCTION_CONFIRM === "READ-ONLY"
    ? null
    : "refused: --production needs TAVONEL_RECONCILE_PRODUCTION_CONFIRM=READ-ONLY";
}

async function pricesReport(_args, env, d) {
  const offers = Object.entries(d.BILLING_OFFERS).map(([code, o]) => ({
    code,
    priceId: env[o.priceEnv]?.trim() || null,
    priceUsd: o.priceUsd,
  }));
  const prices = new Map();
  for (const id of new Set(offers.map((o) => o.priceId).filter(Boolean))) {
    const r = await d.getPaddlePrice(id, env);
    if (!r.ok && r.code === "PADDLE_API_NOT_CONFIGURED") return { exit: 2, message: NO_KEY };
    prices.set(id, r.ok ? r.price : null); // an unreadable price is reported by priceBookDelta as price_unreadable
  }
  const delta = d.priceBookDelta(offers, prices);
  return { exit: delta.length ? 1 : 0, report: { offersChecked: offers.length, delta } };
}

async function transactionsReport(args, env, d) {
  const ledger = await d.readLedgerForReconciliation(args.since);
  if (!ledger.ok) {
    return ledger.code === "BILLING_STORE_NOT_CONFIGURED"
      ? { exit: 2, message: "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured" }
      : { exit: 3, message: ledger.code };
  }
  const q = { updatedAfter: args.since };
  const tx = await d.listPaddleTransactions(q, env);
  const adj = tx.ok ? await d.listPaddleAdjustments(q, env) : tx;
  if (!tx.ok || !adj.ok) {
    const code = (!tx.ok ? tx : adj).code;
    return code === "PADDLE_API_NOT_CONFIGURED" ? { exit: 2, message: NO_KEY } : { exit: 3, message: code };
  }
  const truncated = ledger.truncated || tx.truncated || adj.truncated;
  const delta = d.processorDelta(ledger.rows, tx.items, adj.items, {
    ledgerSince: args.since,
    processorUpdatedAfter: args.since,
    truncated,
  });
  const empty = ["missingInLedger", "missingAtProcessor", "creditMismatch", "reversalMissing", "reversalUnexpected"]
    .every((k) => delta[k].length === 0);
  return {
    exit: empty && !truncated ? 0 : 1,
    report: { counts: { ledgerRows: ledger.rows.length, transactions: tx.items.length, adjustments: adj.items.length }, delta },
  };
}

/** `deps` is injectable so tests never touch Paddle; the default loads the real modules. */
export async function run(argv, env = process.env, deps, now = new Date()) {
  const args = parseArgs(argv, now);
  if (args.error) return { exit: 2, out: args.error };
  const refusal = environmentRefusal(args, env);
  if (refusal) return { exit: 2, out: refusal };
  const d = deps ?? (await loadDeps());
  if (!d.readPaddleApiConfig(env)) return { exit: 2, out: NO_KEY };
  const result = await (args.command === "prices" ? pricesReport : transactionsReport)(args, env, d);
  if (!result.report) return { exit: result.exit, out: result.message };
  const body = {
    schema: RECONCILE_SCHEMA,
    command: args.command,
    environment: args.production ? "production" : "sandbox",
    since: args.since,
    ...result.report,
  };
  return { exit: result.exit, out: args.json ? JSON.stringify(body) : JSON.stringify(body, null, 2) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(
    ({ exit, out }) => {
      console.log(out);
      process.exitCode = exit;
    },
    (error) => {
      console.error(`paddle-reconcile failed: ${error instanceof Error ? error.name : "unknown"}`);
      process.exitCode = 3;
    },
  );
}
