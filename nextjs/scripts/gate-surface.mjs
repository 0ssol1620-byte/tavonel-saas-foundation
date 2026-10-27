import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/*
 * D-05 (docs/adr/0006-release-continuity-by-gate-surface.md). The gate surface of a commit is every
 * tracked path except the presentational ones named in gate-surface-rules.json, read from that same
 * commit. Its digest is a pure function of the commit: git blob ids, not working-tree bytes, so a
 * Windows CRLF checkout and the Vercel build agree. A production release recorded with this digest
 * also covers a deployment whose own digest is equal. Anything that cannot be computed is null,
 * and null inherits nothing: the gate then needs a release for the exact SHA, as before.
 */
export const GATE_SURFACE_RULES_PATH = "nextjs/scripts/gate-surface-rules.json";
const REVISION = /^[0-9a-f]{40}$/;
const SCHEMA = "tavonel.gate_surface.v1";

/** Pure. `rules` as in gate-surface-rules.json; `tree` is `git ls-tree -r -z --full-tree` output. */
export function gateSurfaceDigest(rules, tree) {
  if (!rules || rules.schemaVersion !== SCHEMA || !Array.isArray(rules.alwaysSurface) ||
    !Array.isArray(rules.presentational)) return null;
  const always = rules.alwaysSurface.map((source) => new RegExp(source));
  const presentational = rules.presentational.map((source) => new RegExp(source));
  const lines = [];
  for (const record of tree.split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, type, object] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (tab < 0 || !mode || !type || !object) return null;
    if (always.some((rule) => rule.test(path)) || !presentational.some((rule) => rule.test(path))) {
      lines.push(`${mode} ${type} ${object}\t${path}`);
    }
  }
  if (!lines.some((line) => line.endsWith(`\t${GATE_SURFACE_RULES_PATH}`))) return null;
  lines.sort();
  return `sha256:${createHash("sha256").update(`${SCHEMA}\n${lines.join("\n")}\n`).digest("hex")}`;
}

/** The digest of one commit in `repositoryRoot`, or null (no git, unknown commit, no rules file). */
export function gateSurfaceOfCommit(repositoryRoot, sha) {
  if (!REVISION.test(sha ?? "")) return null;
  const git = (...args) => execFileSync("git", ["-C", repositoryRoot, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  try {
    const rules = JSON.parse(git("show", `${sha}:${GATE_SURFACE_RULES_PATH}`));
    return gateSurfaceDigest(rules, git("ls-tree", "-r", "-z", "--full-tree", sha));
  } catch {
    return null;
  }
}

/** For next.config.mjs: the deployment's own commit only. HEAD must be VERCEL_GIT_COMMIT_SHA when set. */
export function deploymentGateSurface(env = process.env) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  let head;
  try {
    head = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().toLowerCase();
  } catch {
    return null;
  }
  const claimed = env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  if (claimed && claimed !== head) return null;
  return gateSurfaceOfCommit(repositoryRoot, head);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const { values } = parseArgs({ args: args[0] === "--" ? args.slice(1) : args, strict: true,
    options: { sha: { type: "string" } } });
  const digest = gateSurfaceOfCommit(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), values.sha ?? "");
  if (!digest) {
    process.stderr.write("usage: pnpm release:gate-surface --sha <40 hex>; the commit must exist locally and carry the rules file\n");
    process.exitCode = 2;
  } else {
    process.stdout.write(`${digest}\n`);
  }
}
