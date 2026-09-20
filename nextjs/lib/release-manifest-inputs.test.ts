import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  digestReleaseFiles,
  requireReleaseCommit,
  requireReleaseManifestOutputPolicy,
  writeReleaseManifest,
  type ReleaseFile,
} from "./release-manifest-inputs";

const roots: string[] = [];
const commit = "a".repeat(40);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tavonel-release-manifest-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("release commit binding", () => {
  it("requires at least one trusted full-SHA claim and rejects mismatches", () => {
    expect(() => requireReleaseCommit(commit, [])).toThrow("trusted release commit SHA is required");
    expect(() => requireReleaseCommit(commit, [{ source: "GITHUB_SHA", value: "main" }])).toThrow(
      "GITHUB_SHA is not a full commit SHA",
    );
    expect(() => requireReleaseCommit(commit, [{ source: "GITHUB_SHA", value: "b".repeat(40) }])).toThrow(
      "GITHUB_SHA does not match checkout HEAD",
    );
  });

  it("rejects conflicting commit claims and accepts matching claims", () => {
    expect(() => requireReleaseCommit(commit, [
        { source: "GITHUB_SHA", value: commit },
        { source: "VERCEL_GIT_COMMIT_SHA", value: "b".repeat(40) },
      ])).toThrow("VERCEL_GIT_COMMIT_SHA does not match checkout HEAD");
    expect(
      requireReleaseCommit(commit.toUpperCase(), [
        { source: "GITHUB_SHA", value: commit },
        { source: "TAVONEL_RELEASE_COMMIT_SHA", value: commit.toUpperCase() },
      ]),
    ).toBe(commit);
  });
});

describe("required artifact hashing", () => {
  it("fails closed on an empty required artifact set", () => {
    expect(() => digestReleaseFiles(fixture(), "site", [])).toThrow(
      "Refusing to digest empty required artifact set: site",
    );
  });

  it("fails closed on duplicate release inputs", () => {
    const root = fixture();
    writeFileSync(join(root, "duplicate.txt"), "content\n");
    expect(() => digestReleaseFiles(root, "site", [
      { path: "duplicate.txt", gitMode: "100644" },
      { path: "duplicate.txt", gitMode: "100644" },
    ])).toThrow("Duplicate release input in site: duplicate.txt");
  });

  it("hashes ordinary repository files deterministically", () => {
    const root = fixture();
    mkdirSync(join(root, "nextjs"));
    writeFileSync(join(root, "nextjs", "index.ts"), "export {};\n");
    const files: ReleaseFile[] = [{ path: "nextjs/index.ts", gitMode: "100644" }];
    expect(digestReleaseFiles(root, "site", files)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(digestReleaseFiles(root, "site", files)).toBe(digestReleaseFiles(root, "site", files));
  });

  it("rejects lexical path escapes and non-regular Git modes", () => {
    const root = fixture();
    expect(() => digestReleaseFiles(root, "site", [{ path: "../outside", gitMode: null }])).toThrow(
      "unsafe path segment",
    );
    expect(() => digestReleaseFiles(root, "site", [{ path: "nextjs/link", gitMode: "120000" }])).toThrow(
      "not a regular Git file",
    );
  });

  it("rejects symlinked files and symlinked parent directories", () => {
    const root = fixture();
    const outside = fixture();
    writeFileSync(join(outside, "payload"), "outside\n");
    symlinkSync(join(outside, "payload"), join(root, "leaf"), "file");
    symlinkSync(outside, join(root, "linked"), "junction");
    expect(() => digestReleaseFiles(root, "site", [{ path: "leaf", gitMode: null }])).toThrow("symbolic links");
    expect(() => digestReleaseFiles(root, "site", [{ path: "linked/payload", gitMode: null }])).toThrow(
      "symbolic links",
    );
  });
});

describe("manifest output", () => {
  it("writes once to a canonical directory outside the repository", () => {
    const repository = fixture();
    const output = fixture();
    const target = join(output, "new", "nested", "manifest.json");
    writeReleaseManifest(repository, target, "{}\n");
    expect(readFileSync(target, "utf8")).toBe("{}\n");
    expect(() => writeReleaseManifest(repository, target, "changed\n")).toThrow("refusing to follow or overwrite");
  });

  it("rejects a symlinked parent that resolves into the repository", () => {
    const repository = fixture();
    const outside = fixture();
    const linkedParent = join(outside, "redirect");
    symlinkSync(repository, linkedParent, "junction");
    expect(() => writeReleaseManifest(repository, join(linkedParent, "manifest.json"), "{}\n")).toThrow(
      "symbolic links",
    );
  });

  it("rejects an existing output symlink", () => {
    const repository = fixture();
    const output = fixture();
    const target = join(output, "manifest.json");
    symlinkSync(join(repository, "victim.json"), target, "file");
    expect(() => writeReleaseManifest(repository, target, "{}\n")).toThrow("refusing to follow or overwrite");
  });

  it("does not let inspection mode publish an incomplete manifest", () => {
    expect(() => requireReleaseManifestOutputPolicy(true, true)).toThrow("inspection-only");
    const output = fixture();
    const target = join(output, "manifest.json");
    const script = fileURLToPath(new URL("../scripts/release-manifest.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      script,
      "--allow-incomplete",
      `--output=${target}`,
    ], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("inspection-only");
    expect(existsSync(target)).toBe(false);
  });
});
