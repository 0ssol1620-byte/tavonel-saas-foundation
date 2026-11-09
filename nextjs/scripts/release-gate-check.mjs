#!/usr/bin/env node
/**
 * Read-only check: does one deployed Git SHA carry a usable customer-data release decision?
 *
 * Under TAVONEL_CUSTOMER_DATA_GATE_VERSION=v2 every workspace grant and every processing read is
 * bound to VERCEL_GIT_COMMIT_SHA (lib/customer-data-admission.ts). A merge to `main` deploys a new
 * SHA, and a SHA without a production release row closes file processing for every workspace
 * (journey map D-05). This reads the latest row per scope with the gate's own query
 * (lib/scoped-customer-data-gate-store.ts), re-verifies it with the gate's own
 * `verifyStoredRelease`, and reports the scopes that are not released and the releases inside the
 * warning window before their 30-day expiry.
 *
 * D-05 (docs/adr/0006): a production row recorded with a gate-surface digest also covers every SHA
 * whose own digest is equal. The check computes the SHA's digest from the local Git history
 * (scripts/gate-surface.mjs) and sends the gate's own OR query; a covered SHA is reported
 * `released` with `inheritedFrom` naming the revision the founder recorded, but only after the row's
 * digest is recomputed from that revision and matches; otherwise it is `surface_mismatch`, not
 * released (a digest pasted from another build, or a revision not fetched here). When the digest cannot
 * be computed (commit not fetched, or older than the rules file) `gateSurfaceSha256` is null and
 * only the exact SHA is read, which can report `missing` for a covered SHA but never `released`
 * for an uncovered one.
 *
 * GET only. It never records, renews or refuses a decision, and it echoes neither evidence text,
 * operator nor reason. Recording a decision is a founder act: docs/runbooks/RELEASE_ORDER.md.
 *
 *   pnpm release:gate-check --sha <40 hex> [--merge-into <40 hex>] [--scope direct_upload] [--scope connector] [--warn-days 7]
 *
 * --merge-into <base>: before a merge, not after. The subject is then the tree that merging --sha into <base> produces
 * (`git merge-tree --write-tree`, the merge-ort GitHub uses), the tree the production build of the merge commit will
 * hash. That commit does not exist yet and no row names it, so only a row naming the merge tree's surface can release
 * it: exit 0 means the deployment is released the moment it is READY. A merge that conflicts, or a commit not fetched
 * here, cannot be predicted (exit 2). docs/runbooks/RELEASE_ORDER.md, "병합 전 출시 행".
 *
 * Exit 0: every requested scope is released for the SHA and none expires inside the window.
 * Exit 1: a requested scope is missing, refused, invalid, surface-mismatched, expired, qualification-only
 *         or expiring.
 * Exit 2: the check could not run (arguments, credentials, store). No report is printed then, so a
 *         store outage is never reported as a missing release.
 */

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { gateSurfaceOfCommit } from "./gate-surface.mjs";
import "./router/register-ts-loader.mjs";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "../lib/supabase-admin.ts";

// Dynamic so the extensionless-import resolver above is registered before the gate module links.
const gate = await import("../../shared/scopedCustomerDataGate.ts");

export const RELEASE_GATE_REPORT_SCHEMA = "tavonel.release_gate_check.v1";
/** Mirrors MAX_AGE_MS in shared/scopedCustomerDataGate.ts (not exported); the test pins it to verifyStoredRelease. */
export const RELEASE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_WARN_DAYS = 7;
const REVISION = /^[0-9a-f]{40}$/;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const time = (value) => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : -Infinity;
};
const desc = (x, y) => (x < y) - (x > y);
const latestFirst = (a, b) =>
  desc(time(a.recorded_at), time(b.recorded_at)) ||
  desc(b.allowed === true, a.allowed === true) ||
  desc(time(a.evaluated_at), time(b.evaluated_at));
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

function checkScope(scope, sha, rows, now, warnMs, surface, surfaceOfCommit) {
  const required = gate.requiredReleaseEvidence(scope);
  const row = rows.filter((entry) => entry && entry.scope === scope && (entry.release_revision === sha ||
    (surface !== null && entry.gate_surface_sha256 === surface)))
    .sort(latestFirst)[0];
  if (!row) return { scope, status: "missing", code: "SCOPED_RELEASE_NOT_FOUND", requiredFacts: [...required] };
  // A qualification row speaks only for its recorded workspace; verify it as that workspace, then
  // report it as what it is: not a release for anyone else.
  const workspaceId = row.stage === "qualification" && typeof row.qualification_workspace_key === "string"
    ? row.qualification_workspace_key : "";
  const verdict = gate.verifyStoredRelease(row, { scope, releaseRevision: sha, workspaceId, gateSurfaceSha256: surface },
    now.getTime());
  if (!verdict.ok) {
    if (verdict.code === "SCOPED_RELEASE_REFUSED") {
      // Re-projected onto known fact names, so nothing else stored in the row reaches the terminal.
      const named = Array.isArray(row.missing) ? row.missing : [];
      return { scope, status: "refused", code: verdict.code, missingFacts: required.filter((fact) => named.includes(fact)) };
    }
    if (verdict.code === "SCOPED_RELEASE_STALE") {
      return { scope, status: "expired", code: verdict.code, evaluatedAt: iso(time(row.evaluated_at)) };
    }
    return { scope, status: "invalid", code: verdict.code };
  }
  const { release } = verdict;
  const evaluated = Date.parse(release.evaluatedAt);
  const expires = Math.min(evaluated + RELEASE_MAX_AGE_MS,
    release.qualification ? Date.parse(release.qualification.expiresAt) : Infinity);
  const timing = {
    evaluatedAt: iso(evaluated),
    expiresAt: iso(expires),
    remainingHours: Math.floor((expires - now.getTime()) / HOUR),
  };
  if (release.stage === "qualification") {
    return { scope, status: "qualification_only", code: "SCOPED_RELEASE_QUALIFICATION_ONLY",
      workspaceKey: release.qualification.workspaceId, missingFacts: [...release.missing], ...timing };
  }
  if (release.releaseRevision !== sha) {
    // The DB and the gate trust the digest the founder typed into the row. Before reporting an
    // inheritance, check that it is the digest of the row's own revision: a digest pasted from
    // another deployment's build log would otherwise open a surface nobody released. A revision
    // that is not fetched here cannot be checked, and an unchecked inheritance is not reported.
    const recomputed = surfaceOfCommit(release.releaseRevision);
    if (recomputed !== row.gate_surface_sha256) {
      return { scope, status: "surface_mismatch", code: "SCOPED_RELEASE_SURFACE_MISMATCH",
        inheritedFrom: release.releaseRevision, recordedGateSurfaceSha256: row.gate_surface_sha256,
        recomputedGateSurfaceSha256: recomputed };
    }
  }
  return { scope, status: expires - now.getTime() <= warnMs ? "expiring" : "released", ...timing,
    ...(release.releaseRevision === sha ? {} : { inheritedFrom: release.releaseRevision }) };
}

/**
 * Pure: release-decision rows, one SHA and that SHA's gate-surface digest (or null) in, report out.
 * Rows naming neither the SHA nor the digest, and rows for other scopes, are ignored.
 * `surfaceOfCommit` recomputes an inherited row's own digest (local Git by default).
 */
export function checkReleaseGate({ rows, sha, scopes, now, warnDays = DEFAULT_WARN_DAYS, gateSurfaceSha256 = null,
  surfaceOfCommit = (revision) => gateSurfaceOfCommit(repositoryRoot, revision) }) {
  if (!REVISION.test(sha)) throw new Error("--sha must be a 40-character lowercase hex Git SHA");
  if (!Array.isArray(rows)) throw new Error("rows must be an array");
  const checked = scopes.map((scope) =>
    checkScope(scope, sha, rows, now, warnDays * DAY, gateSurfaceSha256, surfaceOfCommit));
  const missingScopes = checked.filter((entry) => entry.status !== "released" && entry.status !== "expiring")
    .map((entry) => entry.scope);
  const expiringScopes = checked.filter((entry) => entry.status === "expiring").map((entry) => entry.scope);
  return {
    schemaVersion: RELEASE_GATE_REPORT_SCHEMA,
    generatedAt: now.toISOString(),
    releaseRevision: sha,
    gateSurfaceSha256,
    warnDays,
    ready: missingScopes.length === 0 && expiringScopes.length === 0,
    missingScopes,
    expiringScopes,
    scopes: checked,
  };
}

export function parseOptions(argv) {
  const { values } = parseArgs({
    // `pnpm release:gate-check -- --sha …` forwards the separator; drop it, nothing else.
    args: argv[0] === "--" ? argv.slice(1) : argv,
    strict: true,
    allowPositionals: false,
    options: {
      sha: { type: "string" },
      scope: { type: "string", multiple: true },
      "warn-days": { type: "string" },
      "merge-into": { type: "string" },
    },
  });
  const sha = values.sha ?? "";
  if (!REVISION.test(sha)) throw new Error("--sha must be a 40-character lowercase hex Git SHA");
  const scopes = [...new Set(values.scope ?? ["direct_upload"])];
  const unknown = scopes.filter((scope) => !gate.customerDataScopes.includes(scope));
  if (unknown.length > 0) throw new Error(`--scope must be one of ${gate.customerDataScopes.join(", ")}`);
  const warnDays = values["warn-days"] === undefined ? DEFAULT_WARN_DAYS : Number(values["warn-days"]);
  if (!Number.isSafeInteger(warnDays) || warnDays < 0 || warnDays > 30) {
    throw new Error("--warn-days must be an integer from 0 to 30");
  }
  const mergeInto = values["merge-into"];
  if (mergeInto !== undefined && !REVISION.test(mergeInto)) {
    throw new Error("--merge-into must be a 40-character lowercase hex Git SHA");
  }
  return { sha, scopes, warnDays, ...(mergeInto === undefined ? {} : { mergeInto }) };
}

/** The tree `git merge` of `head` into `base` produces. Throws on a conflict or a commit not fetched here. */
export function mergeTreeOf(root, base, head) {
  let tree = "";
  try {
    tree = execFileSync("git", ["--no-replace-objects", "-c", "core.fsmonitor=false", "-C", root, "merge-tree",
      "--write-tree", base, head], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n")[0];
  } catch {
    // A conflict exits 1 with the tree and the conflict list on stdout; neither predicts what GitHub would build.
  }
  if (!REVISION.test(tree)) {
    throw new Error(`--merge-into: git merge-tree ${base} ${head} did not merge cleanly (conflict, or a commit not fetched here)`);
  }
  return tree;
}

/** One GET per scope, the gate's exact select, filter, order and limit (gate.releaseDecisionQuery). */
export async function readReleaseRows(config, sha, scopes, request = supabaseAdminRequest, gateSurfaceSha256 = null) {
  const rows = [];
  for (const scope of scopes) {
    const query = gate.releaseDecisionQuery(scope, sha, gateSurfaceSha256);
    const response = await request(config, `/rest/v1/customer_data_release_decisions?${query}`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    // Status only: an error body is not echoed into an operator terminal or its scrollback.
    if (!response.ok) throw new Error(`customer_data_release_decisions (${scope}) -> HTTP ${response.status}`);
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body) || body.length > 1 || body.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error(`customer_data_release_decisions (${scope}) -> unexpected response body`);
    }
    rows.push(...body);
  }
  return rows;
}

export async function run(argv, env, now = new Date(), root = repositoryRoot) {
  const options = parseOptions(argv);
  const config = readSupabaseAdminConfig(env);
  if (!config) throw new Error("needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  // Before a merge the subject is the merge tree: no row can name it, so only its surface can release it.
  const subject = options.mergeInto === undefined ? options.sha : mergeTreeOf(root, options.mergeInto, options.sha);
  const gateSurfaceSha256 = gateSurfaceOfCommit(root, subject);
  const rows = await readReleaseRows(config, subject, options.scopes, supabaseAdminRequest, gateSurfaceSha256);
  const report = checkReleaseGate({ rows, sha: subject, scopes: options.scopes, now, warnDays: options.warnDays,
    gateSurfaceSha256, surfaceOfCommit: (revision) => gateSurfaceOfCommit(root, revision) });
  return options.mergeInto === undefined ? report
    : { ...report, mergeOf: { base: options.mergeInto, head: options.sha, tree: subject } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2), process.env).then(
    (report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.ready ? 0 : 1;
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    },
  );
}
