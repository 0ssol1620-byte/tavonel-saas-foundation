import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

/*
  robots.txt, sitemap.xml and llms.txt describe the same public surface, and nothing kept them
  agreeing.

  They drifted for a whole campaign: `/benchmarks` and `/product/continuous-knowledge` were
  listed in the sitemap and Benchmarks was presented in `llms.txt` while robots.txt disallowed
  both. Every file was individually defensible and the set was a contradiction -- the site told
  a crawler where to go and then told it not to go there. The failure is silent, which is why it
  survived: each file renders, each is valid, and only reading all three together shows it.

  Two invariants, checked against the route tree rather than a second hand-written list:
  a URL this site advertises must resolve to a page, and must not be one robots.txt withholds.
*/

const appDirectory = resolve(import.meta.dirname, "../app");
const ORIGIN = "https://tavonel.com";

function findPages(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...findPages(path));
    else if (entry === "page.tsx") found.push(path);
  }
  return found;
}

/*
  A route pattern, not a literal: `/docs/[section]` has to match `/docs/exports`, and a list of
  literal routes would have to be maintained beside the sitemap that already generates them.
*/
function routeMatcherOf(pagePath: string): RegExp {
  const pattern = relative(appDirectory, pagePath)
    .split(sep)
    .filter((segment) => segment && segment !== "page.tsx")
    // `[...slug]` swallows the rest of the path, `[section]` one segment, everything else is a
    // literal. Route directories are lowercase words and hyphens, so nothing here needs escaping.
    .map((segment) => (/^\[\.\.\..+\]$/.test(segment) ? ".+" : /^\[.+\]$/.test(segment) ? "[^/]+" : segment))
    .join("/");
  return new RegExp(`^/${pattern}$`);
}

const routeMatchers = findPages(appDirectory).map(routeMatcherOf);
const isRealRoute = (path: string) => path === "/" ? routeMatchers.some((m) => m.test("/")) : routeMatchers.some((m) => m.test(path));

/*
  robots.txt path semantics: a Disallow value is a prefix match on the path. None of ours use the
  `*` or `$` wildcards, so a prefix test is the whole rule -- and it is the reason `/api/` carries
  its trailing slash, which is what keeps the public `/api` marketing page crawlable.
*/
const genericRule = robots().rules;
const genericDisallow = (Array.isArray(genericRule) ? genericRule : [genericRule]).filter((rule) => rule.userAgent === "*").flatMap((rule) => (Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : []));
const disallowedFor = (path: string) => genericDisallow.filter((token) => path === token || path.startsWith(token));

const sitemapPaths = sitemap().map((entry) => new URL(entry.url).pathname);
const llmsPaths = [...readFileSync(resolve(import.meta.dirname, "../public/llms.txt"), "utf8").matchAll(/https:\/\/tavonel\.com(\/[^)\s]*)?/g)].map((match) => (match[1] ?? "/").replace(/\/$/, "") || "/");

describe("public surface: robots, sitemap and llms.txt agree", () => {
  it("has paths to check in all three files", () => {
    expect(sitemapPaths.length).toBeGreaterThan(20);
    expect(llmsPaths.length).toBeGreaterThan(20);
    expect(genericDisallow.length).toBeGreaterThan(0);
  });

  it.each([...new Set([...sitemapPaths, ...llmsPaths])])("%s is a real route", (path) => {
    expect(isRealRoute(path), `${ORIGIN}${path} is advertised but no page.tsx resolves it`).toBe(true);
  });

  it.each([...new Set([...sitemapPaths, ...llmsPaths])])("%s is not disallowed for *", (path) => {
    expect(disallowedFor(path), `${ORIGIN}${path} is advertised and withheld by robots.txt`).toEqual([]);
  });

  /*
    The named search crawlers exist so discovery is explicit, and they inherit the same private
    list. A rule that allowed one of them past a path `*` is withheld from would be a leak written
    as an optimisation.
  */
  it("gives every named crawler the same private list as *", () => {
    const rules = Array.isArray(genericRule) ? genericRule : [genericRule];
    expect(rules.map((rule) => rule.userAgent)).toEqual(["OAI-SearchBot", "PerplexityBot", "Googlebot", "*"]);
    for (const rule of rules) expect(rule.disallow, `${String(rule.userAgent)} disagrees with *`).toEqual(genericDisallow);
  });

  /*
    Training-crawler policy is a founder and legal decision (§8.4). This test does not decide it;
    it only refuses to let it be decided here by a copy-paste.
  */
  it("takes no position on training crawlers", () => {
    const rules = Array.isArray(genericRule) ? genericRule : [genericRule];
    const agents = rules.map((rule) => String(rule.userAgent));
    for (const training of ["Google-Extended", "GPTBot", "CCBot", "ClaudeBot", "anthropic-ai", "Applebot-Extended"]) {
      expect(agents, `${training} is a training-crawler policy, not an SEO change`).not.toContain(training);
    }
  });
});
