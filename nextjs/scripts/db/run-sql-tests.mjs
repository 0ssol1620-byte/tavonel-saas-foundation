/**
 * Run supabase/tests/*.sql against a disposable local PostgreSQL with a pgTAP subset.
 *
 *   node scripts/db/run-sql-tests.mjs --dsn postgres://postgres@127.0.0.1:55439/tavonel_local [--files a.sql,b.sql]
 *
 * A fast local check; db-rehearsal with real pgTAP and pgvector is the authority.
 * Build the cluster first with apply-migrations.mjs --shim-vector. PASS / FAIL / UNSUPPORTED:
 * UNSUPPORTED (a pgTAP function outside the subset, or a pgvector literal) is never counted as PASS.
 * Exit 0 = every file PASS, 1 = any FAIL, 2 = refused or setup failed, 3 = nothing FAILED but
 * something is UNSUPPORTED.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const TESTS = resolve(import.meta.dirname, "../../../supabase/tests");
const SUBSET = resolve(import.meta.dirname, "pgtap-subset.sql");

export function isLoopbackDsn(dsn) {
  try {
    const u = new URL(dsn);
    return ["127.0.0.1", "localhost"].includes(u.hostname) && !u.searchParams.has("host") && !u.searchParams.has("hostaddr");
  } catch {
    return false;
  }
}

/* pgTAP function families the subset does not carry; an app function missing is a real FAIL. */
const PGTAP_NAME =
  /^(has_|hasnt_|table_|sequence_|schema_|database_|language_|type_|enum_|domain_|view_|rule_|owner_|volatility_|col_|fk_|is_|isnt_|results_|set_|bag_|policies_|policy_|schemas_|tables_|functions_|function_|roles_|columns_|views_|isa_|cmp_|row_|throws_|performs_|index|trigger|can$|matches|imatches|alike|unalike|like$|unlike|pass$|fail$|diag|todo|skip|lives_|ok_)/;
const MISSING_FN = /function (?:[\w."]+\.)?"?([a-z_0-9]+)"?\([^)]*\) does not exist/g;
const PGVECTOR = /extension "pgtap" is not available|malformed array literal: "\[|operator does not exist: .*(<->|<=>|<#>)|type "?vector"? does not exist/;

/** @returns {"PASS"|"FAIL"|"UNSUPPORTED"} from one psql run of one test file. */
export function classifyRun({ status, stdout, stderr }) {
  const lines = stdout.split(/\r?\n/);
  if (lines.some((l) => /^not ok \d+/.test(l)) || /TAP FAIL/.test(stderr)) return "FAIL";
  const missing = [...stderr.matchAll(MISSING_FN)].map((m) => m[1]);
  if ((missing.length > 0 && missing.every((n) => PGTAP_NAME.test(n))) || PGVECTOR.test(stderr)) return "UNSUPPORTED";
  const finished = lines.some((l) => /^# all \d+ passed$/.test(l));
  return status === 0 && finished && lines.some((l) => /^ok \d+/.test(l)) ? "PASS" : "FAIL";
}

export function exitCodeFor(results) {
  if (results.some((r) => r.result === "FAIL")) return 1;
  return results.some((r) => r.result === "UNSUPPORTED") ? 3 : 0;
}

function psql(dsn, file) {
  const r = spawnSync(process.env.PSQL || "psql", ["-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-d", dsn, "-f", file], { encoding: "utf8", env: { ...process.env, PGOPTIONS: "-c lc_messages=C", PGCLIENTENCODING: "UTF8" } });
  if (r.error) throw new Error(`cannot run psql (set PSQL or fix PATH): ${r.error.message}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function main(argv) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const dsn = arg("--dsn");
  if (!dsn || !isLoopbackDsn(dsn)) {
    console.error("refusing: --dsn must point at 127.0.0.1 or localhost (disposable cluster only)");
    return 2;
  }
  const installed = psql(dsn, SUBSET);
  if (installed.status !== 0) {
    console.error(`pgTAP subset install failed:\n${installed.stderr}`);
    return 2;
  }
  const files = arg("--files")
    ? arg("--files").split(",").filter(Boolean)
    : readdirSync(TESTS).filter((f) => f.endsWith(".sql")).sort();
  const results = files.map((file) => {
    const run = psql(dsn, join(TESTS, file));
    const result = classifyRun(run);
    const detail =
      result === "PASS"
        ? ""
        : (run.stderr.split(/\r?\n/).find((l) => /ERROR|TAP FAIL|not ok/.test(l)) ?? run.stdout.split(/\r?\n/).find((l) => /^not ok/.test(l)) ?? "").trim();
    return { file, result, detail };
  });
  for (const r of results) console.log(`${r.result.padEnd(11)} ${r.file}${r.detail ? `  -- ${r.detail}` : ""}`);
  const count = (k) => results.filter((r) => r.result === k).length;
  console.log(JSON.stringify({ pass: count("PASS"), fail: count("FAIL"), unsupported: count("UNSUPPORTED"), results }));
  console.log("note: a fast local check; db-rehearsal with real pgTAP and pgvector is the authority.");
  return exitCodeFor(results);
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) process.exitCode = main(process.argv.slice(2));
