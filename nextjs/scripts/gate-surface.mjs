import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
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
 *
 * A symlink (mode 120000) or a gitlink (160000) is surface whatever its name: a link named like a
 * presentational file can point a build-time include at any directory (R4 SEC B2).
 */
export const GATE_SURFACE_RULES_PATH = "nextjs/scripts/gate-surface-rules.json";
const REVISION = /^[0-9a-f]{40}$/;
const SCHEMA = "tavonel.gate_surface.v1";
/** The hashed text's own version; v2 is one JSON array per surface entry. */
const DIGEST_SCHEMA = "tavonel.gate_surface_digest.v2";
const SURFACE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const LINK_MODES = new Set(["120000", "160000"]);
/** Every git call here: no fsmonitor hook can report "unchanged", no refs/replace object stands in. */
const gitArguments = (repositoryRoot, args) =>
  ["--no-replace-objects", "-c", "core.fsmonitor=false", "-C", repositoryRoot, ...args];

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
    if (LINK_MODES.has(mode) || always.some((rule) => rule.test(path)) ||
      !presentational.some((rule) => rule.test(path))) {
      lines.push(JSON.stringify([mode, type, object, path]));
      rulesFile ||= path === GATE_SURFACE_RULES_PATH;
    }
  }
  if (!rulesFile) return null;
  lines.sort();
  return `sha256:${createHash("sha256").update(`${DIGEST_SCHEMA}\n${lines.join("\n")}\n`).digest("hex")}`;
}

/**
 * The digest of one commit in `repositoryRoot`, or null (no git, unknown commit, no rules file). `gitPath` is the git
 * binary: PATH lookup by default (a local check), the resolved absolute path in the deploy step.
 */
export function gateSurfaceOfCommit(repositoryRoot, sha, gitPath = "git") {
  if (!REVISION.test(sha ?? "")) return null;
  // Fatal decoding: a lossy one would map two different byte paths onto one string.
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const git = (...args) => utf8.decode(execFileSync(gitPath, gitArguments(repositoryRoot, args),
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
 * R5 SEC B2. pnpm puts nextjs/node_modules/.bin first on PATH, and Vercel restores node_modules from the build cache
 * before the build runs, so a `node` or `git` found there is not the system's: whatever an earlier build left could
 * report the released tree. The deploy step trusts neither the checkout nor any node_modules directory for its tools.
 * It refuses when the node running it, or the first `node` the shell would have found on PATH, is inside the
 * repository or a node_modules directory, and it calls git by the absolute path of the first `git` on PATH outside
 * both. Every path is judged as given and with links resolved. Throws with the reason; the build stops.
 * Defence in depth, not the boundary: production build cache is an untrusted input, and the release depends on the
 * Production setting VERCEL_FORCE_NO_BUILD_CACHE=1 (docs/adr/0006).
 */
export function resolveDeployTools(repositoryRoot = REPOSITORY_ROOT,
  { path = process.env.PATH ?? "", execPath = process.execPath, pathExt = process.env.PATHEXT } = {}) {
  const windows = process.platform === "win32";
  const fold = (value) => (windows ? value.toLowerCase() : value);
  const forms = (value) => {
    const given = resolve(value);
    let real = given;
    try { real = realpathSync.native(given); } catch { /* a missing path is judged as given */ }
    return [fold(given), fold(real)];
  };
  const roots = forms(repositoryRoot);
  const untrusted = (value) => forms(value).some((form) => form.split(/[\\/]/).includes("node_modules") ||
    roots.some((root) => form === root || form.startsWith(root.endsWith(sep) ? root : root + sep)));
  const executable = (file) => {
    try {
      if (!statSync(file).isFile()) return false;
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (untrusted(execPath)) {
    throw new Error(`gate-surface --deploy: node is ${execPath}, inside the repository or a node_modules directory. The deploy ` +
      "step runs only under a node that neither the checkout nor the build cache can supply; the build stops.");
  }
  const entries = path.split(delimiter).filter((entry) => entry !== "");
  const nodeNames = windows
    ? ["node", ...(pathExt || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((ext) => `node${ext.toLowerCase()}`)]
    : ["node"];
  const nodeEntry = entries.find((entry) => nodeNames.some((name) => executable(join(entry, name))));
  if (nodeEntry !== undefined && untrusted(nodeEntry)) {
    throw new Error(`gate-surface --deploy: the first node on PATH is in ${nodeEntry}, inside the repository or a node_modules ` +
      "directory, so the shell may have started this step through it; the build stops.");
  }
  for (const entry of entries) {
    if (!isAbsolute(entry) || untrusted(entry)) continue;
    const file = join(entry, windows ? "git.exe" : "git");
    if (executable(file) && !untrusted(file)) return { git: file };
  }
  throw new Error("gate-surface --deploy: no git on PATH outside the repository and node_modules directories; the build stops.");
}

/**
 * The first command of a Vercel production build (package.json `prebuild`, before `pnpm check` and the
 * hermetic vitest run), so no repository code but this file and the builtin-only ignoreCommand has run
 * on the build machine yet (release-gate-check.test.mjs, "the digest is the first thing the production
 * build runs"). Only a Vercel production build of its own commit claims a surface: a preview or local
 * build claims none, so a pushed, unreviewed branch never inherits a production release, and HEAD must
 * be VERCEL_GIT_COMMIT_SHA, the SHA the gate binds to. The digest comes from HEAD's blob ids, so this
 * claims nothing when Git can see that the checkout differs from HEAD: an edited, staged or untracked,
 * not ignored, file (a local `vercel build --prod` deployed with `--prebuilt`), or any index entry
 * marked skip-worktree or assume-unchanged, which `git status` would otherwise not report.
 */
export function deploymentGateSurface(env = process.env, repositoryRoot = REPOSITORY_ROOT, toolOptions = {}) {
  const claimed = env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  if (env.VERCEL_ENV !== "production" || !claimed) return null;
  const { git: gitPath } = resolveDeployTools(repositoryRoot, toolOptions);
  const git = (...args) => execFileSync(gitPath, gitArguments(repositoryRoot, args),
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  let head;
  try {
    head = git("rev-parse", "HEAD").trim().toLowerCase();
    // `git status` compares HEAD, index and working tree, so a staged change is reported too.
    if (claimed !== head || git("status", "--porcelain").length > 0) return null;
    // `ls-files -v` tags a skip-worktree entry S and an assume-unchanged one in lower case.
    if (git("ls-files", "-v", "-z").split("\0").some((entry) => /^(S|[a-z])/.test(entry))) return null;
  } catch {
    return null;
  }
  return gateSurfaceOfCommit(repositoryRoot, head, gitPath);
}

/** Where the deploy step leaves its result for next.config.mjs: outside the checkout, one file per SHA. */
export function deploymentGateSurfaceFile(env = process.env, directory = tmpdir()) {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase() ?? "";
  return env.VERCEL_ENV === "production" && REVISION.test(sha)
    ? join(directory, `tavonel-gate-surface-${sha}.json`) : null;
}

/**
 * `--deploy`. Computes the deployment's digest once and records it (null included) for next.config.mjs.
 * Throws when a record for this SHA already exists: the step runs once per build, and a second run, or a
 * record something else left, is not trusted. Outside a Vercel production build it writes nothing.
 */
export function recordDeploymentGateSurface(env = process.env, repositoryRoot = REPOSITORY_ROOT, directory = tmpdir(),
  toolOptions = {}) {
  const file = deploymentGateSurfaceFile(env, directory);
  if (file === null) return null;
  const digest = deploymentGateSurface(env, repositoryRoot, toolOptions);
  const revision = env.VERCEL_GIT_COMMIT_SHA.trim().toLowerCase();
  try {
    writeFileSync(file, `${JSON.stringify({ schemaVersion: SCHEMA, revision, digest })}\n`, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    throw new Error(`gate-surface --deploy: ${file} already exists. The step records once per build and trusts no record it ` +
      "did not just write, so the build stops. If an earlier local `vercel build --prod` of this SHA left it, delete that " +
      "file and build again.", { cause: error });
  }
  return digest;
}

/** For next.config.mjs: only reads what `--deploy` recorded for this SHA, never recomputes; else null. */
export function readDeploymentGateSurface(env = process.env, directory = tmpdir()) {
  const file = deploymentGateSurfaceFile(env, directory);
  if (file === null) return null;
  try {
    const record = JSON.parse(readFileSync(file, "utf8"));
    return record.schemaVersion === SCHEMA && record.revision === env.VERCEL_GIT_COMMIT_SHA.trim().toLowerCase() &&
      SURFACE_DIGEST.test(record.digest) ? record.digest : null;
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const { values } = parseArgs({ args: args[0] === "--" ? args.slice(1) : args, strict: true,
    options: { sha: { type: "string" }, deploy: { type: "boolean" } } });
  if (values.deploy) {
    // A second run for the same SHA, or a node or git the checkout or build cache could supply, stops the build (exit 1).
    let digest;
    try {
      digest = recordDeploymentGateSurface();
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
    process.stdout.write(`customer-data gate surface (deploy step): ${digest ?? "none (exact-SHA release only)"}
`);
    process.exit(0);
  }
  const digest = gateSurfaceOfCommit(REPOSITORY_ROOT, values.sha ?? "");
  if (!digest) {
    process.stderr.write("usage: node scripts/gate-surface.mjs --sha <40 hex> | --deploy (from nextjs/); the commit must exist locally and carry the rules file\n");
    process.exitCode = 2;
  } else {
    process.stdout.write(`${digest}\n`);
  }
}
