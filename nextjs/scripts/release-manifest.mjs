import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseManifest } from "../lib/release-manifest.ts";
import {
  digestReleaseFiles,
  requireReleaseCommit,
  requireReleaseManifestOutputPolicy,
  writeReleaseManifest,
} from "../lib/release-manifest-inputs.ts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const argumentsSet = new Set(process.argv.slice(2));
const allowIncomplete = argumentsSet.has("--allow-incomplete");
const stdoutOnly = argumentsSet.has("--stdout");
const outputArgument = process.argv.find((value) => value.startsWith("--output="));
requireReleaseManifestOutputPolicy(allowIncomplete, Boolean(outputArgument));

function git(...args) {
  return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8" }).trim();
}

function repositoryFiles() {
  const files = new Map();
  const staged = execFileSync("git", ["-C", repositoryRoot, "ls-files", "--stage", "-z"], { encoding: "utf8" });
  for (const record of staged.split("\0").filter(Boolean)) {
    const separator = record.indexOf("\t");
    const metadata = record.slice(0, separator).split(" ");
    const path = record.slice(separator + 1);
    const [gitMode, , stage] = metadata;
    if (separator < 0 || stage !== "0") throw new Error(`Unmerged or malformed Git index entry: ${path}`);
    files.set(path, { path, gitMode });
  }
  const untracked = execFileSync(
    "git",
    ["-C", repositoryRoot, "ls-files", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  );
  for (const path of untracked.split("\0").filter(Boolean)) files.set(path, { path, gitMode: null });
  return [...files.values()].sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ));
}

function optionalDigest(name) {
  const value = process.env[name]?.trim().toLowerCase() ?? "";
  return /^sha256:[a-f0-9]{64}$/.test(value) ? value : null;
}

const files = repositoryFiles();
const siteFiles = files.filter(({ path }) => path.startsWith("nextjs/") && !path.startsWith("nextjs/test-results/"));
const schemaFiles = files.filter(({ path }) => path.startsWith("supabase/migrations/")
  || path === "drizzle/schema.ts"
  || (path.startsWith("shared/") && (path.endsWith(".schema.json") || path.endsWith("Contract.ts"))));
const policyFiles = files.filter(({ path }) => path.startsWith("docs/policy/")
  || path === "nextjs/lib/activation-policy.ts"
  || path === "nextjs/lib/commercial-state.ts");
const ocrEvidence = JSON.parse(readFileSync(resolve(repositoryRoot, "docs/evidence/ocr/release.json"), "utf8"));
const dirty = git("status", "--porcelain", "--untracked-files=all").length > 0;
const headCommit = git("rev-parse", "--verify", "HEAD^{commit}").toLowerCase();
const commitClaims = [
  { source: "TAVONEL_RELEASE_COMMIT_SHA", value: process.env.TAVONEL_RELEASE_COMMIT_SHA },
  { source: "GITHUB_SHA", value: process.env.GITHUB_SHA },
  { source: "VERCEL_GIT_COMMIT_SHA", value: process.env.VERCEL_GIT_COMMIT_SHA },
];
requireReleaseCommit(
  headCommit,
  allowIncomplete && commitClaims.every(({ value }) => !value?.trim())
    ? [{ source: "inspection checkout", value: headCommit }]
    : commitClaims,
);

const manifest = buildReleaseManifest({
  generatedAt: new Date().toISOString(),
  site: {
    commit: headCommit,
    sourceDigest: digestReleaseFiles(repositoryRoot, "site", siteFiles),
    dirty,
  },
  productCore: {
    digest: optionalDigest("TAVONEL_PRODUCT_CORE_IMAGE_DIGEST"),
    source: "deployment:TAVONEL_PRODUCT_CORE_IMAGE_DIGEST",
  },
  images: {
    ocr: {
      digest: /^sha256:[a-f0-9]{64}$/.test(ocrEvidence.imageDigest) ? ocrEvidence.imageDigest : null,
      source: "docs/evidence/ocr/release.json",
    },
    cdr: {
      digest: optionalDigest("TAVONEL_CDR_IMAGE_DIGEST"),
      source: "deployment:TAVONEL_CDR_IMAGE_DIGEST",
    },
  },
  databaseSchema: {
    digest: digestReleaseFiles(repositoryRoot, "database schema", schemaFiles),
    source: "supabase/migrations+shared schemas",
  },
  policyBundle: {
    digest: digestReleaseFiles(repositoryRoot, "policy bundle", policyFiles),
    source: "docs/policy+runtime policy",
  },
});

if (manifest.status !== "bindings_complete" && !allowIncomplete) {
  throw new Error(`Release manifest is incomplete: ${manifest.missing.join(", ")}`);
}
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
if (stdoutOnly || !outputArgument) process.stdout.write(serialized);
if (outputArgument) {
  const requested = outputArgument.slice("--output=".length);
  writeReleaseManifest(repositoryRoot, requested, serialized);
}
