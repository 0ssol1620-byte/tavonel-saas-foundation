import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync, constants, existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync,
} from "node:fs";
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

/**
 * D-05 v2. One .gitignore line as gitignore(5) reads it, or null for a blank line or a comment. Matching is
 * case-sensitive, as git is on Linux. A line this cannot translate exactly (a POSIX class, an escape inside a bracket,
 * an unclosed bracket) throws, so the checkout then has no digest rather than one built on a guess.
 */
function ignorePattern(line) {
  let text = line.endsWith("\r") ? line.slice(0, -1) : line;
  // Trailing spaces are dropped unless escaped with a backslash.
  while (text.endsWith(" ") && !text.endsWith("\\ ")) text = text.slice(0, -1);
  if (text === "" || text.startsWith("#")) return null;
  const unsupported = () => new Error(`gate surface: unsupported .gitignore line ${JSON.stringify(line)}`);
  const negate = text.startsWith("!");
  if (negate) text = text.slice(1);
  const directoryOnly = text.endsWith("/");
  if (directoryOnly) text = text.slice(0, -1);
  // A separator at the start or in the middle anchors the pattern to its .gitignore's directory.
  const anchored = text.includes("/");
  if (text.startsWith("/")) text = text.slice(1);
  if (text === "") throw unsupported();
  const literal = (c) => c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  let source = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const doubleStar = c === "*" && text[i + 1] === "*" && (i === 0 || text[i - 1] === "/");
    if (c === "\\" && i + 1 < text.length) {
      source += literal(text[i + 1]);
      i += 1;
    } else if (doubleStar && i + 2 === text.length) {
      source += ".*"; // trailing `/**`: everything inside
      i += 1;
    } else if (doubleStar && text[i + 2] === "/") {
      source += "(?:.*/)?"; // leading `**/` or inner `/**/`: zero or more directories
      i += 2;
    } else if (c === "*") {
      while (text[i + 1] === "*") i += 1;
      source += "[^/]*";
    } else if (c === "?") {
      source += "[^/]";
    } else if (c === "[") {
      const negated = text[i + 1] === "!" || text[i + 1] === "^";
      const end = text.indexOf("]", i + (negated ? 3 : 2));
      const body = end < 0 ? "" : text.slice(i + (negated ? 2 : 1), end);
      if (end < 0 || body.includes("\\") || body.includes("[:")) throw unsupported();
      source += `(?!/)[${negated ? "^" : ""}${body.replace(/[\]^]/g, "\\$&")}]`;
      i = end;
    } else {
      source += literal(c);
    }
  }
  return { negate, directoryOnly, anchored, pattern: new RegExp(`^${source}$`, "s") };
}

/**
 * D-05 v2. Vercel writes `vercel.json` at the repository root right after the clone, before the ignoreCommand: the
 * Root Directory's nextjs/vercel.json, parsed and written back as one line (D05-V2-DIAGNOSIS.md, round 2). It is
 * untracked and not ignored, so `git status` reported it and v1 claimed nothing on every production build. The walk
 * leaves it out only when it says exactly what the committed nextjs/vercel.json says (same JSON, same key order);
 * any other root vercel.json stays in the text and moves the digest.
 */
function platformVercelJson(repositoryRoot) {
  try {
    const parsed = (path) => JSON.stringify(JSON.parse(readFileSync(join(repositoryRoot, path), "utf8")));
    return lstatSync(join(repositoryRoot, "vercel.json")).isFile() && parsed("vercel.json") === parsed("nextjs/vercel.json");
  } catch {
    return false;
  }
}

/**
 * D-05 v2. The checkout as `git ls-tree -r -z --full-tree` lists a commit, read from the files themselves rather than
 * from git's index or its line-ending-normalised view, and with no .git directory needed. It walks every directory under
 * `repositoryRoot`, leaves out the top-level `.git` and what the checkout's own .gitignore files ignore (node_modules,
 * .next, .vercel, .env*, ...), and gives each file git's blob id, sha1("blob <size>\0" + bytes). The mode is git's:
 * 120000 for a symlink (its blob is the link text), 100755 when the owner may execute the file, else 100644. On a
 * checkout of a commit whose tracked files no .gitignore matches, the text is that commit's ls-tree output up to
 * order, and gateSurfaceDigest sorts. Everything else on disk stays in the text: an edited, added or missing file
 * moves the digest. null when the tree cannot be read exactly: a path that is not UTF-8, a nested `.git` (a submodule
 * or an embedded repository), a symlinked .gitignore, a .gitignore line ignorePattern refuses, a special file.
 */
export function checkoutTree(repositoryRoot) {
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const records = [];
  const walk = (relative, inherited) => {
    const directory = relative === "" ? repositoryRoot : join(repositoryRoot, relative);
    let rules = inherited;
    const ignoreFile = join(directory, ".gitignore");
    const ignoreStat = lstatSync(ignoreFile, { throwIfNoEntry: false });
    if (ignoreStat !== undefined) {
      if (!ignoreStat.isFile()) throw new Error(`gate surface: ${ignoreFile} is not a regular file`);
      rules =[...inherited, ...readFileSync(ignoreFile, "utf8").split("\n").map(ignorePattern).filter(Boolean)
        .map((rule) => ({ ...rule, base: relative }))];
    }
    for (const raw of readdirSync(directory, { encoding: "buffer" })) {
      const name = utf8.decode(raw);
      const path = relative === "" ? name : `${relative}/${name}`;
      const absolute = join(repositoryRoot, path);
      if (name === ".git") {
        if (relative === "") continue;
        throw new Error(`gate surface: ${path} is a nested repository`);
      }
      if (path === "vercel.json" && platformVercelJson(repositoryRoot)) continue;
      const stat = lstatSync(absolute);
      const directoryEntry = stat.isDirectory();
      // The last matching line wins and a deeper .gitignore comes later; an ignored directory is never entered, as in git.
      let ignored = false;
      for (const rule of rules) {
        if (rule.directoryOnly && !directoryEntry) continue;
        if (rule.base !== "" && !path.startsWith(`${rule.base}/`)) continue;
        const subject = rule.anchored ? (rule.base === "" ? path : path.slice(rule.base.length + 1)) : name;
        if (rule.pattern.test(subject)) ignored = !rule.negate;
      }
      if (ignored) continue;
      if (directoryEntry) {
        walk(path, rules);
        continue;
      }
      let bytes;
      let mode;
      if (stat.isSymbolicLink()) {
        bytes = readlinkSync(absolute, { encoding: "buffer" });
        mode = "120000";
      } else if (stat.isFile()) {
        bytes = readFileSync(absolute);
        mode = stat.mode & 0o100 ? "100755" : "100644";
      } else {
        throw new Error(`gate surface: ${path} is neither a file nor a symlink`);
      }
      records.push(`${mode} blob ${createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")}\t${path}\0`);
    }
  };
  try {
    walk("", []);
  } catch {
    return null;
  }
  return records.join("");
}

/**
 * D-05 v2. The digest of the files in `repositoryRoot` as they are, with the rules read from the rules file among them.
 * Equal to gateSurfaceOfCommit of the commit that was checked out, when the checkout holds exactly that commit's files.
 */
export function gateSurfaceOfCheckout(repositoryRoot) {
  const tree = checkoutTree(repositoryRoot);
  if (tree === null) return null;
  try {
    return gateSurfaceDigest(JSON.parse(readFileSync(join(repositoryRoot, GATE_SURFACE_RULES_PATH), "utf8")), tree);
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
 * Defence in depth, not the boundary: production build cache is an untrusted input. A cache-restored
 * node_modules/.bin/node runs this step in place of the real node, so none of these checks runs and nothing here can
 * stop it; the Production setting VERCEL_FORCE_NO_BUILD_CACHE=1 is what stops it (docs/adr/0006), and
 * deploymentGateSurface claims nothing without it.
 */
export function resolveDeployTools(repositoryRoot = REPOSITORY_ROOT,
  { path = process.env.PATH ?? "", execPath = process.execPath, pathExt = process.env.PATHEXT, git = true } = {}) {
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
  // D-05 v2: a checkout without .git is digested from its files alone, so no git is looked for.
  if (!git) return { git: null };
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
 * build claims none, so a pushed, unreviewed branch never inherits a production release.
 *
 * D-05 v2. The digest is the checkout's own (gateSurfaceOfCheckout): the bytes this build compiles, not git's view of
 * them. v1 required an empty `git status --porcelain`, and no Vercel build ever had one (D05-V2-DIAGNOSIS.md): Vercel
 * writes an untracked root vercel.json after the clone, and supabase/tests/foundation_approved_connection_batch_binding.sql
 * is committed with mixed line endings under `eol=lf`, so git reports it modified on every fresh checkout although its
 * bytes are the committed blob's. With a .git directory, git still vouches for the claim: HEAD must be
 * VERCEL_GIT_COMMIT_SHA, no index entry may be marked skip-worktree or assume-unchanged, and the checkout digest must
 * equal HEAD's committed digest, so an edited, added or deleted surface file (a local `vercel build --prod` deployed
 * with `--prebuilt`) claims nothing. Without one (git is not required on the build machine), the checkout digest
 * stands alone: the step cannot tell the files are VERCEL_GIT_COMMIT_SHA's and trusts Vercel's fresh clone of that
 * commit exactly as the deployment trusts the code it runs; a restored build cache is still kept out by the setting.
 */
export function deploymentGateSurface(env = process.env, repositoryRoot = REPOSITORY_ROOT, toolOptions = {}) {
  const claimed = env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  if (env.VERCEL_ENV !== "production" || !claimed) return null;
  const withGit = existsSync(join(repositoryRoot, ".git"));
  const { git: gitPath } = resolveDeployTools(repositoryRoot, { ...toolOptions, git: withGit });
  // R6 SEC N1: without the setting that keeps a restored cache out of the build, claim nothing rather than rely on it.
  if (env.VERCEL_FORCE_NO_BUILD_CACHE !== "1") return null;
  const digest = gateSurfaceOfCheckout(repositoryRoot);
  if (!withGit || digest === null) return digest;
  const git = (...args) => execFileSync(gitPath, gitArguments(repositoryRoot, args),
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  let head;
  try {
    head = git("rev-parse", "HEAD").trim().toLowerCase();
    if (claimed !== head) return null;
    // `ls-files -v` tags a skip-worktree entry S and an assume-unchanged one in lower case.
    if (git("ls-files", "-v", "-z").split("\0").some((entry) => /^(S|[a-z])/.test(entry))) return null;
  } catch {
    return null;
  }
  return digest === gateSurfaceOfCommit(repositoryRoot, head, gitPath) ? digest : null;
}

export const NO_BUILD_CACHE_REFUSAL = "gate-surface --deploy: VERCEL_FORCE_NO_BUILD_CACHE is not 1 in this production " +
  "build, so a restored build cache could have replaced node or git; the step records none (exact-SHA release only).";

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
    if (digest === null && deploymentGateSurfaceFile() !== null && process.env.VERCEL_FORCE_NO_BUILD_CACHE !== "1") {
      process.stderr.write(`${NO_BUILD_CACHE_REFUSAL}\n`);
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
