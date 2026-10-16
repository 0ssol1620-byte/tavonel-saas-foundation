import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/*
 * Vercel "Ignored Build Step" (vercel.json ignoreCommand): exit 0 skips the build, exit 1 builds.
 *
 * Every push to an automation branch used to start a full Turbo-machine preview build (prebuild
 * repeats typecheck, lint and the whole unit suite that GitHub CI already runs). Production
 * always builds. Automation branches (codex/*, dependabot/*) build only on explicit opt-in with
 * "[preview]" in the commit subject line; a body that merely mentions the token does not opt in.
 * Other preview branches skip only documentation-only commits.
 * Any uncertainty (missing metadata, unreadable diff) builds, so this can only remove builds that
 * are known to be redundant. Revert by deleting ignoreCommand from vercel.json.
 */
const AUTOMATION_BRANCH = /^(codex|dependabot)\//;

/*
 * Prepared, NOT applied: the project-level "Ignored Build Step" equivalent for branches whose
 * vercel.json has no ignoreCommand (e.g. dependabot/* cut from main, which built a READY preview).
 * vercel.json ignoreCommand overrides the project setting, so branches carrying this script keep
 * it. Self-contained POSIX sh (no repository file), because main-derived branches lack this script
 * and a missing file would exit non-zero, i.e. build. It mirrors decide()'s first three rules only;
 * the docs-only rule is omitted, so it can only build more, never less. Revert: clear the setting.
 */
export const PROJECT_IGNORE_COMMAND =
  `[ "$VERCEL_ENV" != production ] && printf %s "$VERCEL_GIT_COMMIT_REF" | grep -Eq '^(codex|dependabot)/' && ! printf '%s\\n' "$VERCEL_GIT_COMMIT_MESSAGE" | head -n 1 | grep -qi '\\[preview\\]'`;
const DOCS_ONLY_PATH = /^docs\/|\.md$/i;

export function decide(env, changedFiles) {
  if (env.VERCEL_ENV === "production") return { build: true, reason: "production" };
  if (/\[preview\]/i.test((env.VERCEL_GIT_COMMIT_MESSAGE ?? "").split("\n", 1)[0])) return { build: true, reason: "explicit [preview] opt-in" };
  const ref = env.VERCEL_GIT_COMMIT_REF ?? "";
  if (AUTOMATION_BRANCH.test(ref)) return { build: false, reason: `automation branch ${ref} without [preview]` };
  if (Array.isArray(changedFiles) && changedFiles.length > 0 && changedFiles.every(file => DOCS_ONLY_PATH.test(file))) {
    return { build: false, reason: "documentation-only commit" };
  }
  return { build: true, reason: changedFiles === null ? "diff unavailable" : "application change" };
}

function changedFilesOfHead() {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "HEAD^", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n").map(line => line.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { build, reason } = decide(process.env, changedFilesOfHead());
  console.log(`vercel-ignore-build: ${build ? "BUILD" : "SKIP"} (${reason})`);
  process.exit(build ? 1 : 0);
}
