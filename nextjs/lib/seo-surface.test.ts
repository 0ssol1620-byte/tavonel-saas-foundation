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

function findFiles(directory: string, filename: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...findFiles(path, filename));
    else if (entry === filename) found.push(path);
  }
  return found;
}

/*
  A route pattern, not a literal: `/docs/[section]` has to match `/docs/exports`, and a list of
  literal routes would have to be maintained beside the sitemap that already generates them.
*/
function segmentsOf(filePath: string, filename: string): string[] {
  return relative(appDirectory, filePath).split(sep).filter((segment) => segment && segment !== filename);
}

function routeMatcherOf(pagePath: string): RegExp {
  const pattern = segmentsOf(pagePath, "page.tsx")
    // `[...slug]` swallows the rest of the path, `[section]` one segment, everything else is a
    // literal. Route directories are lowercase words and hyphens, so nothing here needs escaping.
    .map((segment) => (/^\[\.\.\..+\]$/.test(segment) ? ".+" : /^\[.+\]$/.test(segment) ? "[^/]+" : segment))
    .join("/");
  return new RegExp(`^/${pattern}$`);
}

/*
  Each page read once, with the two facts every assertion below needs: the pattern it answers to,
  and whether it opts itself out of search. Reading the metadata rather than keeping a second list
  of noindex routes is the same choice the sitemap makes about `DOCS_SECTIONS` -- a hand-kept list
  is the thing that goes stale silently.
*/
/*
  The retired-URL stub, matched on its shape rather than on the words in it.

  `notFound()` appearing in a file proves nothing: `/docs/[section]` and `/solutions/[slug]` call it
  for an unknown slug, and `/product/continuous-knowledge` -- a live 200 page -- both mentions
  `notFound()` and quotes the retired-stub sentence in a comment explaining that it used to be one.
  A substring test called that page a 404. The whole component body is the discriminator: a stub is
  a default export that does nothing but 404.
*/
const RETIRED_STUB_BODY = /export default function \w+\(\)\s*\{\s*notFound\(\);\s*\}/;
const RETIRED_STUB_REASON = "stable 404 for retired inbound URLs";

const pages = findFiles(appDirectory, "page.tsx").map((path) => {
  const source = readFileSync(path, "utf8");
  const alwaysNotFound = RETIRED_STUB_BODY.test(source);
  return {
    route: `/${segmentsOf(path, "page.tsx").join("/")}`,
    matcher: routeMatcherOf(path),
    noindex: /robots:\s*\{[^}]*index:\s*false/.test(source),
    alwaysNotFound,
    // Both halves: it must actually 404 for everyone, and it must say why.
    retiredStub: alwaysNotFound && source.includes(RETIRED_STUB_REASON),
  };
});

const routeMatchers = pages.map((page) => page.matcher);
const isRealRoute = (path: string) => path === "/" ? routeMatchers.some((m) => m.test("/")) : routeMatchers.some((m) => m.test(path));
const isNoindex = (path: string) => pages.some((page) => page.matcher.test(path) && page.noindex);

/*
  robots.txt path semantics: a Disallow value is a prefix match on the path. None of ours use the
  `*` or `$` wildcards, so a prefix test is the whole rule -- and it is the reason `/api/` carries
  its trailing slash, which is what keeps the public `/api` marketing page crawlable.
*/
const genericRule = robots().rules;
const genericDisallow = (Array.isArray(genericRule) ? genericRule : [genericRule]).filter((rule) => rule.userAgent === "*").flatMap((rule) => (Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : []));

/*
  robots.txt now carries two kinds of rule, and they are split here by shape rather than by a
  second copy of the token lists: a search rule allows the public surface and withholds the private
  paths, a training rule allows nothing. The tests below assert the membership of each group, so a
  token that moves between them fails rather than being silently re-classified by this split.
*/
const allRules = Array.isArray(genericRule) ? genericRule : [genericRule];
const TRAINING_RULES = allRules.filter((rule) => rule.allow === undefined);
const SEARCH_RULES = allRules.filter((rule) => rule.allow !== undefined);
const crawlerPolicy = readFileSync(resolve(import.meta.dirname, "../../docs/policy/CRAWLER_POLICY.md"), "utf8");
const disallowedFor = (path: string) => genericDisallow.filter((token) => path === token || path.startsWith(token));

/*
  The other direction of the same prefix rule: what does a Disallow line actually withhold?

  A token ending in `/` withholds a subtree, so it is answered by any page or API handler beneath
  it; a token without one names a single route. Route handlers count -- `/api/` is disallowed for
  the 76 endpoints under it, not for the `/api` marketing page, and a check that only looked at
  `page.tsx` would call the most important line in the file dead.
*/
const handlerRoutes = findFiles(appDirectory, "route.ts").map((path) => `/${segmentsOf(path, "route.ts").join("/")}`);
const allRoutes = [...pages.map((page) => page.route), ...handlerRoutes];
const withheldBy = (token: string) => allRoutes.filter((route) => route === token || route.startsWith(token.endsWith("/") ? token : `${token}/`));

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
    The third pairing, and the one that was missing while the other two passed.

    `llms.txt` and `sitemap.xml` both advertise; the checks above only ask whether what they
    advertise exists and is allowed. `/reproducibility` was in `llms.txt`, live, allowed, and in
    neither list of the sitemap, and every assertion in this file was green -- because none of
    them read the two advertising files against each other.

    The exemption is narrow on purpose. A sitemap entry asks a search engine to index; a page
    that declares `robots: { index: false }` asks it not to; listing such a page in the sitemap
    would be the site contradicting itself, so the guard reads the page's own metadata and
    accepts exactly that case. Anything else advertised to models and withheld from crawlers is
    drift, and fails here.
  */
  it.each([...new Set(llmsPaths)])("%s is in the sitemap, or declares itself noindex", (path) => {
    if (sitemapPaths.includes(path)) return;
    expect(isNoindex(path), `${ORIGIN}${path} is in llms.txt but in neither the sitemap nor a noindex page`).toBe(true);
  });

  /*
    The exemption above is only worth having if it can tell the two cases apart, and a metadata
    regex that silently stopped matching would turn this whole class green by exempting
    everything. Both directions are named.
  */
  it("reads noindex from the page rather than assuming it", () => {
    expect(isNoindex("/reproducibility"), "the one deliberate llms-only URL no longer reads as noindex").toBe(true);
    expect(isNoindex("/benchmarks"), "an indexable page reads as noindex, so the exemption admits anything").toBe(false);
    expect(pages.filter((page) => page.noindex).length).toBeGreaterThan(0);
  });

  /*
    The named search crawlers exist so discovery is explicit, and they inherit the same private
    list. A rule that allowed one of them past a path `*` is withheld from would be a leak written
    as an optimisation.
  */
  it("gives every named search crawler the same private list as *", () => {
    expect(SEARCH_RULES.map((rule) => rule.userAgent)).toEqual(["OAI-SearchBot", "PerplexityBot", "Googlebot", "*"]);
    for (const rule of SEARCH_RULES) expect(rule.disallow, `${String(rule.userAgent)} disagrees with *`).toEqual(genericDisallow);
  });

  /*
    Training-crawler policy is a delegated decision, 2026-09-11 (orchestrator, under the founder's
    delegation) -- FD-61 in `docs/policy/DECISION_LOG_2026-09-11.md`, reversible by the founder --
    and the reasoning is in `docs/policy/CRAWLER_POLICY.md`. The eight tokens below are disallowed
    everywhere. This test no longer refuses the position -- it pins it, in both directions.

    Both directions, because the two ways this drifts are opposite and each is silent. A training
    token that loses its Disallow gives away a licence position in a commit about SEO; a search
    crawler that arrives in the training list by copy-paste removes the site from search, and every
    other assertion in this file would still pass.
  */
  const TRAINING_TOKENS = ["GPTBot", "CCBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "Applebot-Extended", "Bytespider", "Meta-ExternalAgent"];

  /*
    A fetch a person asked for is a visit, not a corpus crawl, so these five stay allowed. Two are
    named groups; the other three fall to `*`, which allows them -- and that is the assertion that
    matters, because "allowed by default" is one careless list edit away from "refused".
  */
  const USER_TRIGGERED_TOKENS = ["Claude-User", "Claude-SearchBot", "ChatGPT-User", "OAI-SearchBot", "PerplexityBot"];

  it("disallows every training crawler everywhere", () => {
    expect(TRAINING_RULES.map((rule) => rule.userAgent)).toEqual(TRAINING_TOKENS);
    for (const rule of TRAINING_RULES) {
      expect(rule.disallow, `${String(rule.userAgent)} must be disallowed at the root`).toBe("/");
      expect(rule.allow, `${String(rule.userAgent)} must not carry an allow rule`).toBeUndefined();
    }
  });

  it("keeps the two groups apart, so neither can become the other", () => {
    for (const search of ["OAI-SearchBot", "PerplexityBot", "Googlebot", "*"]) {
      expect(TRAINING_TOKENS, `${search} in the training block would remove this site from search`)
        .not.toContain(search);
    }
    for (const training of TRAINING_TOKENS) {
      expect(SEARCH_RULES.map((rule) => String(rule.userAgent)), `${training} is not a search crawler`)
        .not.toContain(training);
    }
    // Search discovery is the point of the site: no public page is withheld from a search crawler.
    for (const rule of SEARCH_RULES) expect(rule.allow).toBe("/");
  });

  /*
    Both of Anthropic's tokens are on the list: `ClaudeBot` is what the current crawler sends and
    `anthropic-ai` is the older one, so listing only the retired token would leave the one in use
    allowed by `*`. FD-61 closed that gap, and it closed only the tokens it named -- the rest stay
    open in the crawler policy, because an open decision that stops being written down is an open
    decision nobody makes.
  */
  it("refuses both of the operator's tokens, not just the retired one", () => {
    for (const token of ["ClaudeBot", "anthropic-ai"]) {
      expect(TRAINING_TOKENS, `${token} is named by FD-61`).toContain(token);
    }
    expect(crawlerPolicy, "the policy must name what it refuses").toContain("ClaudeBot");
    expect(crawlerPolicy, "robots.txt is a request, not a technical measure").toContain("not access control");
  });

  it("keeps user-triggered fetchers allowed, and says so where it can be read", () => {
    const trainingAgents = TRAINING_RULES.map((rule) => String(rule.userAgent));
    for (const token of USER_TRIGGERED_TOKENS) {
      expect(TRAINING_TOKENS, `${token} fetches because a person asked; refusing it is a visit refused`)
        .not.toContain(token);
      expect(trainingAgents, `${token} must not reach robots.txt as a disallow-all group`).not.toContain(token);
      expect(crawlerPolicy, `${token} is allowed on purpose and the policy has to say which ones`).toContain(token);
    }
  });

  it("records the tokens FD-61 did not rule on, rather than letting them look decided", () => {
    for (const token of ["Amazonbot", "Diffbot", "Omgilibot", "Timpibot", "PanguBot"]) {
      expect(TRAINING_TOKENS, `${token} was not decided and must not arrive by default`).not.toContain(token);
      expect(crawlerPolicy, `${token} has to stay named as open`).toContain(token);
    }
    expect(crawlerPolicy, "the document has to keep an open list at all").toContain("Still open");
  });
});

/*
  A Disallow line is a claim that there is something there to withhold.

  Four of them -- `/research/experiments`, `/film-2`, `/film-3`, `/film-4` -- were reported as
  pointing at nothing and proposed for deletion. All four resolve to `notFound()` stubs that exist
  so a withdrawn URL keeps returning a stable 404, and the disallow line is what stops a crawler
  re-walking it every pass. That is a decision worth keeping, and worth being able to tell apart
  from a leftover, which is the whole job of these two assertions: a token that answers to nothing
  is a leftover, and a token that answers only with an unexplained 404 is indistinguishable from
  one.
*/
describe("public surface: every disallowed path is deliberate", () => {
  it.each(genericDisallow)("%s withholds something that exists", (token) => {
    expect(withheldBy(token).length, `robots.txt disallows ${token} and no page or route handler answers it`).toBeGreaterThan(0);
  });

  it.each(genericDisallow)("%s is a live surface or an annotated retired URL", (token) => {
    const stub = pages.find((page) => page.route === token && page.alwaysNotFound);
    expect(
      stub === undefined || stub.retiredStub,
      `${token} is disallowed and 404s without saying it is a retired URL -- annotate it or drop the disallow line`,
    ).toBe(true);
  });

  /*
    Same reason as the noindex reader above: an annotation check that stopped recognising the
    annotation would pass every path by finding no stub at all. The second assertion is the one
    that catches the opposite mistake -- a live page mentioning the stub sentence in a comment
    being read as a 404, which a substring test did.
  */
  it("recognises the retired-URL stubs it is guarding, and nothing else", () => {
    expect(pages.filter((page) => page.retiredStub).map((page) => page.route).sort()).toEqual(["/customers", "/film-2", "/film-3", "/film-4", "/research/experiments"]);
    expect(pages.find((page) => page.route === "/product/continuous-knowledge")?.alwaysNotFound, "a live page that describes the stub pattern is being read as a stub").toBe(false);
  });
});
