import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/*
  WO-CI-37 item 1. `app/sitemap.ts` dates a route with the last commit that touched its file. In a shallow
  clone the boundary commit "touches" every file it still holds, so an untouched page would be published with a
  date that looks real and is not (Vercel builds from a shallow clone). The module reads git from
  `process.cwd()` when it is imported, so each case makes a real repository, clones it (shallow or not) with
  git, moves into the clone's `nextjs/` directory and imports a fresh copy of the module. The repository is a
  synthetic one of five commits holding an empty file for every path the real package has under the folders the
  sitemap reads, so it is fast; the real repository's own history (a minute of `git log` here) adds nothing.
*/

const PACKAGE = resolve(import.meta.dirname, "..");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let scratch: string;
let source: string;
const startedIn = process.cwd();
const DAYS = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01"];

/** Five commits: the first adds every file, each later one touches one page, on five different days. */
function makeSource(): string {
  const dir = join(scratch, "source");
  mkdirSync(dir);
  git(dir, "init", "--quiet");
  const tracked = git(PACKAGE, "ls-files", "--", "app", "components/v34/routes", "lib/docs-content.ts").split("\n").filter(Boolean);
  for (const file of tracked) {
    mkdirSync(join(dir, "nextjs", dirname(file)), { recursive: true });
    writeFileSync(join(dir, "nextjs", file), "");
  }
  const touched = ["app/page.tsx", "app/trust/page.tsx", "app/pricing/page.tsx", "app/contact/page.tsx"];
  DAYS.forEach((day, index) => {
    if (index > 0) writeFileSync(join(dir, "nextjs", touched[index - 1]!), `${day}\n`);
    git(dir, "add", "-A");
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "--quiet", "-m", day], {
      cwd: dir, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_DATE: `${day}T12:00:00Z`, GIT_COMMITTER_DATE: `${day}T12:00:00Z` },
    });
  });
  return dir;
}

function clone(label: string, ...depth: string[]): string {
  const dir = join(scratch, label);
  git(scratch, "clone", "--quiet", ...depth, `file:///${source.replaceAll("\\", "/")}`, dir);
  return dir;
}

async function sitemapIn(dir: string) {
  process.chdir(join(dir, "nextjs"));
  vi.resetModules();
  return (await import("@/app/sitemap")).default();
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "sitemap-shallow-"));
  source = makeSource();
}, 120_000);
afterEach(() => process.chdir(startedIn));
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 3 }));

describe("sitemap lastModified on a shallow clone", () => {
  it.each([["depth-1", "1"], ["depth-3", "3"]] as const)(
    "a %s clone publishes no lastModified for any entry (the boundary commit's date is not a page's)",
    async (label, depth) => {
      const dir = clone(label, "--depth", depth);
      expect(git(dir, "rev-parse", "--is-shallow-repository")).toBe("true");
      const entries = await sitemapIn(dir);
      expect(entries.length).toBeGreaterThan(10);
      expect(entries.filter((entry) => "lastModified" in entry).map((entry) => entry.url)).toEqual([]);
    },
    120_000,
  );

  it("a full clone still dates every entry with its own last commit", async () => {
    const dir = clone("full");
    expect(git(dir, "rev-parse", "--is-shallow-repository")).toBe("false");
    const entries = await sitemapIn(dir);
    expect(entries.filter((entry) => !(entry.lastModified instanceof Date)).map((entry) => entry.url)).toEqual([]);
    // The commits' own days: the home page was last touched on day 2, /trust on day 3, an untouched page on day 1.
    const byUrl = new Map(entries.map((entry) => [entry.url, (entry.lastModified as Date).toISOString().slice(0, 10)]));
    expect(byUrl.get("https://tavonel.com")).toBe("2026-02-01");
    expect(byUrl.get("https://tavonel.com/trust")).toBe("2026-03-01");
    expect(new Set(byUrl.values()).has("2026-01-01")).toBe(true);
  }, 120_000);

  it("a directory that is not a repository publishes no lastModified either", async () => {
    const dir = join(scratch, "no-git");
    mkdirSync(join(dir, "nextjs"), { recursive: true });
    const entries = await sitemapIn(dir);
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.filter((entry) => "lastModified" in entry)).toEqual([]);
  });
});
