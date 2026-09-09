import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/*
  A secret scan that runs, rather than a secret scan that was run once (blueprint §43, P-13/P-14).

  The previous evidence for "no secret literal in the repository" was a grep somebody typed in a
  session, recorded in a report. That is true about the commit it was typed against and says
  nothing about the next one. This is the same grep as a required CI step, so the day a key is
  pasted into a file the merge stops instead of a future audit finding it.

  Two rules govern everything below:

    NEVER PRINT THE MATCH. A scanner that echoes what it found writes the secret into a CI log
    that is far more widely readable than the file was. Findings are file, line and pattern name.

    NEVER CONTAIN THE MATCH. The patterns are assembled at runtime from pieces, so this file does
    not itself contain a string it would flag. That is not cosmetic: the alternative is a scanner
    that has to exclude itself, and an excluded path is the first place a secret can hide.
*/

const BEGIN_BLOCK = `${"-".repeat(5)}BEGIN`;

/** name -> regex. Names are what gets printed; the pattern never is. */
const PATTERNS = [
  ["openai-style-key", new RegExp(`sk${"-"}[A-Za-z0-9_-]{20,}`)],
  ["stripe-live-secret-key", new RegExp(`sk${"_"}live${"_"}[A-Za-z0-9]{10,}`)],
  ["stripe-live-publishable-key", new RegExp(`pk${"_"}live${"_"}[A-Za-z0-9]{10,}`)],
  ["aws-access-key-id", new RegExp("AKIA" + "[A-Z0-9]{12,}")],
  ["pem-private-key-block", new RegExp(`${BEGIN_BLOCK} [A-Z ]*PRIVATE KEY`)],
  ["jwt-shaped-literal", new RegExp(`ey${"J"}[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\.`)],
];

/**
 * The only two `NEXT_PUBLIC_*` variables that may carry a sensitive-sounding name.
 *
 * Both are designed to be public: the Supabase anon key is the key RLS is written against, and
 * the Paddle client token is what the checkout script needs in the browser. A third one is not
 * necessarily a leak -- it is a variable nobody has decided is publishable, which is the moment
 * to decide rather than the moment to ship.
 */
const PUBLIC_ENV_ALLOWLIST = new Set([
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN",
]);
const SENSITIVE_ENV_NAME = /NEXT_PUBLIC_[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*/g;

const SKIP_DIRECTORIES = new Set([
  ".git", "node_modules", ".next", ".turbo", ".vercel", "coverage", "dist", "build",
  ".e2e_modules", "playwright-report", "test-results", "venv", "__pycache__",
]);
const SKIP_FILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);
const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".svg", ".pdf", ".zip", ".gz",
  ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".webm", ".mp3", ".wasm", ".bin",
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function* walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (SKIP_DIRECTORIES.has(name)) continue;
      yield* walk(path);
      continue;
    }
    if (SKIP_FILES.has(name)) continue;
    const dot = name.lastIndexOf(".");
    if (dot > 0 && SKIP_EXTENSIONS.has(name.slice(dot).toLowerCase())) continue;
    if (stat.size > MAX_FILE_BYTES) continue;
    yield path;
  }
}

/**
 * Findings for one root, as data.
 *
 * Returned rather than printed so the test can drive the same function the CI step drives. A
 * scanner whose only interface is its exit code is a scanner whose logic has no test.
 */
export function scanForSecrets(root) {
  const findings = [];
  for (const path of walk(root)) {
    let source;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    // A file that is mostly NUL is a binary this scan cannot read usefully.
    if (source.includes(String.fromCharCode(0))) continue;
    const file = relative(root, path).split(sep).join("/");
    const lines = source.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const [name, pattern] of PATTERNS) {
        if (pattern.test(line)) findings.push({ file, line: index + 1, pattern: name });
      }
      for (const match of line.matchAll(SENSITIVE_ENV_NAME)) {
        if (!PUBLIC_ENV_ALLOWLIST.has(match[0])) {
          findings.push({ file, line: index + 1, pattern: `public-env-not-allowlisted:${match[0]}` });
        }
      }
    }
  }
  return findings;
}

if ((process.argv[1] ?? "").endsWith("secret-scan.mjs")) {
  const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, ".."));
  const findings = scanForSecrets(root);
  for (const finding of findings) {
    // file:line and the pattern's NAME. Never the matched text.
    console.error(`secret-scan: ${finding.file}:${finding.line} matched ${finding.pattern}`);
  }
  if (findings.length > 0) {
    console.error(`secret-scan: ${findings.length} finding(s) in ${root}`);
    process.exit(1);
  }
  console.log(`secret-scan: clean (${root})`);
}
