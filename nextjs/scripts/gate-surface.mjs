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
 *
 * The hashed text is injective in the surface entries. `git ls-tree -z` ends each record with NUL,
 * which no Git path can contain; mode, type and object hold neither tab nor space, so the first tab
 * ends them. Each surface entry is then one JSON array [mode, type, object, path]: JSON.stringify
 * escapes every control character, LF included, so no line holds a raw LF, the lines split back
 * exactly and each parses back to its own entry. A path that is not valid UTF-8 cannot be decoded
 * without loss, so that tree has no digest. (Digest v1 joined raw `mode type object<TAB>path` text
 * with LF, and one path holding LF could stand in for neighbouring entries: two trees, one digest.)
 */
export const GATE_SURFACE_RULES_PATH = "nextjs/scripts/gate-surface-rules.json";
const REVISION = /^[0-9a-f]{40}$/;
const SCHEMA = "tavonel.gate_surface.v1";
/** The hashed text's own version; v2 is one JSON array per surface entry. */
const DIGEST_SCHEMA = "tavonel.gate_surface_digest.v2";

/** Pure. `rules` as in gate-surface-rules.json; `tree` is `git ls-tree -r -z --full-tree` output. */
export function gateSurfaceDigest(rules, tree) {
  if (!rules || rules.schemaVersion !== SCHEMA || !Array.isArray(rules.alwaysSurface) ||
    !Array.isArray(rules.presentational)) return null;
  const always = rules.alwaysSurface.map((source) => new RegExp(source));
  const presentational = rules.presentational.map((source) => new RegExp(source));
  const lines = [];
  let rulesFile = false;
  for (const record of tree.split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, type, object, extra] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (tab < 0 || !mode || !type || !object || extra !== undefined || !path) return null;
    if (always.some((rule) => rule.test(path)) || !presentational.some((rule) => rule.test(path))) {
      lines.push(JSON.stringify([mode, type, object, path]));
      rulesFile ||= path === GATE_SURFACE_RULES_PATH;
    }
  }
  if (!rulesFile) return null;
  lines.sort();
  return `sha256:${createHash("sha256").update(`${DIGEST_SCHEMA}\n${lines.join("\n")}\n`).digest("hex")}`;
}

/** The digest of one commit in `repositoryRoot`, or null (no git, unknown commit, no rules file). */
export function gateSurfaceOfCommit(repositoryRoot, sha) {
  if (!REVISION.test(sha ?? "")) return null;
  // Fatal decoding: a lossy one would map two different byte paths onto one string.
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const git = (...args) => utf8.decode(execFileSync("git", ["-C", repositoryRoot, ...args],
    { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }));
  try {
    const rules = JSON.parse(git("show", `${sha}:${GATE_SURFACE_RULES_PATH}`));
    return gateSurfaceDigest(rules, git("ls-tree", "-r", "-z", "--full-tree", sha));
  } catch {
    return null;
  }
}

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * For next.config.mjs: a Vercel production build of its own commit only. A preview or local build
 * claims no surface, so a pushed, unreviewed branch never inherits a production release; and HEAD
 * must be VERCEL_GIT_COMMIT_SHA, the SHA the gate binds to. The digest comes from HEAD's blob ids,
 * not from the bytes being built, so this claims nothing when Git can see that the tracked or
 * untracked, not ignored, bytes differ from HEAD: an edited, staged or untracked file (a local
 * `vercel build --prod` deployed with `--prebuilt`), or any index entry marked skip-worktree or
 * assume-unchanged, which `git status` would otherwise not report. Git cannot see ignored inputs
 * (node_modules, .env*, build caches). Those are closed only by keeping every file the production
 * build runs before this point on the surface (release-gate-check.test.mjs, "the production build
 * runs no presentational code"), not by this check.
 */
export function deploymentGateSurface(env = process.env, repositoryRoot = REPOSITORY_ROOT) {
  const claimed = env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  if (env.VERCEL_ENV !== "production" || !claimed) return null;
  const git = (...args) => execFileSync("git", ["-C", repositoryRoot, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  let head;
  try {
    head = git("rev-parse", "HEAD").trim().toLowerCase();
    if (claimed !== head || git("status", "--porcelain").length > 0) return null;
    // `ls-files -v` tags a skip-worktree entry S and an assume-unchanged one in lower case.
    if (git("ls-files", "-v", "-z").split("\0").some((entry) => /^(S|[a-z])/.test(entry))) return null;
    git("diff-index", "--cached", "--quiet", "HEAD", "--"); // exit 1 (throws) when the index is not HEAD
  } catch {
    return null;
  }
  return gateSurfaceOfCommit(repositoryRoot, head);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const { values } = parseArgs({ args: args[0] === "--" ? args.slice(1) : args, strict: true,
    options: { sha: { type: "string" } } });
  const digest = gateSurfaceOfCommit(REPOSITORY_ROOT, values.sha ?? "");
  if (!digest) {
    process.stderr.write("usage: node scripts/gate-surface.mjs --sha <40 hex> (from nextjs/); the commit must exist locally and carry the rules file\n");
    process.exitCode = 2;
  } else {
    process.stdout.write(`${digest}\n`);
  }
}
