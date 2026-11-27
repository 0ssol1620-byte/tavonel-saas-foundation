#!/usr/bin/env node
/**
 * Read-only RTR-4 report over the page router shadow (foundation_router_shadow_traces, ADR-012 section 5).
 *
 * It reads through read_router_shadow_traces (service_role only; 20261127060000), never writes and never calls a
 * reader or a provider. The aggregation is lib/router-shadow-report.ts. The default output is the INTERNAL report
 * (class mix, candidate routes, reasons, pre-read features): an operator receipt for receipts/WO-RTR-4/, never a
 * public page. `--public` prints the separate public summary type, which carries counts and readiness only.
 *
 *   pnpm router:shadow:report                         # every trace, internal JSON
 *   pnpm router:shadow:report -- --hours 168 --markdown
 *   pnpm router:shadow:report -- --public
 *
 * A read longer than the bound is reported incomplete (TRUNCATED) and never ready for review.
 * (Until 2026-11-27 this script read the retrieval router's control plane; that readback is the SQL block in
 * docs/runbooks/ROUTER_SHADOW_ROLLOUT.md section "Read the evidence back".)
 */

import { pathToFileURL } from "node:url";

import {
  buildRouterShadowReport,
  renderRouterShadowReportMarkdown,
  toPublicRouterShadowSummary,
} from "../../lib/router-shadow-report.ts";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "../../lib/supabase-admin.ts";

/** Rows per read; the database refuses above it. A window with more is reported TRUNCATED, not cut silently. */
export const SHADOW_REPORT_READ_LIMIT = 50_000;

/** Reads the window. Fails loudly on any store error: a report over a failed read is not a report. */
export async function readShadowTraces(config, since, limit = SHADOW_REPORT_READ_LIMIT) {
  const response = await supabaseAdminRequest(config, "/rest/v1/rpc/read_router_shadow_traces", {
    method: "POST",
    body: JSON.stringify({ p_since: since.toISOString(), p_limit: limit }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  // The body may echo a database error; only the status leaves.
  if (!response.ok) throw new Error(`read_router_shadow_traces -> HTTP ${response.status}`);
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error("read_router_shadow_traces -> not a row list");
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

export function parseShadowReportArgs(args, now) {
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 || index === args.length - 1 ? null : args[index + 1];
  };
  const hours = value("--hours");
  if (hours !== null && !(Number(hours) > 0)) throw new Error("--hours must be a positive number");
  return {
    since: hours === null ? new Date(0) : new Date(now.getTime() - Number(hours) * 3_600_000),
    output: args.includes("--public") ? "public" : args.includes("--markdown") ? "markdown" : "json",
  };
}

export function renderShadowReport(report, output) {
  if (output === "public") return `${JSON.stringify(toPublicRouterShadowSummary(report), null, 2)}\n`;
  if (output === "markdown") return renderRouterShadowReportMarkdown(report);
  return `${JSON.stringify(report, null, 2)}\n`;
}

async function main(argv) {
  const now = new Date();
  const { since, output } = parseShadowReportArgs(argv.slice(2), now);
  const config = readSupabaseAdminConfig(process.env);
  if (!config) throw new Error("needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const read = await readShadowTraces(config, since);
  process.stdout.write(renderShadowReport(buildRouterShadowReport({ ...read, since, now }), output));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
