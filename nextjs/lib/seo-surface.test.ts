import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Metadata } from "next";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { COOKBOOKS, COOKBOOK_SLUGS } from "./cookbook-content";
import { publicPageLocation } from "./marketing-analytics";
import { pageMetadata } from "./page-seo";

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

/*
  The parameter names come out with the pattern, so a dynamic route's own `generateMetadata` can
  be called for a concrete advertised URL instead of being skipped. That is what lets the noindex
  reader below read `/docs/exports` and a future `/cookbooks/<slug>` as the head each one renders.
*/
type RouteParam = { name: string; catchAll: boolean };

function routeMatcherOf(pagePath: string): { matcher: RegExp; params: RouteParam[] } {
  const params: RouteParam[] = [];
  const pattern = segmentsOf(pagePath, "page.tsx")
    // `[...slug]` swallows the rest of the path, `[section]` one segment, everything else is a
    // literal. Route directories are lowercase words and hyphens, so nothing here needs escaping.
    .map((segment) => {
      const dynamic = /^\[(\.\.\.)?(.+)\]$/.exec(segment);
      if (!dynamic) return segment;
      params.push({ name: dynamic[2], catchAll: dynamic[1] !== undefined });
      return dynamic[1] ? "(.+)" : "([^/]+)";
    })
    .join("/");
  return { matcher: new RegExp(`^/${pattern}$`), params };
}

/*
  Each page read once, for the two facts a file can answer: the pattern it responds to, and whether
  it is a retired-URL stub. Whether it opts itself out of search is a value in its head, not a word
  in the file, and is read further down by evaluating that head.
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
    file: path,
    route: `/${segmentsOf(path, "page.tsx").join("/")}`,
    ...routeMatcherOf(path),
    alwaysNotFound,
    // Both halves: it must actually 404 for everyone, and it must say why.
    retiredStub: alwaysNotFound && source.includes(RETIRED_STUB_REASON),
  };
});

const routeMatchers = pages.map((page) => page.matcher);
const isRealRoute = (path: string) => path === "/" ? routeMatchers.some((m) => m.test("/")) : routeMatchers.some((m) => m.test(path));

/*
  robots.txt path semantics: a Disallow value is a prefix match on the path. None of ours use the
  `*` or `$` wildcards, so a prefix test is the whole rule -- and it is the reason `/api/` carries
  its trailing slash, which is what keeps the public `/api` marketing page crawlable.
*/
const genericRule = robots().rules;
const genericDisallow = (Array.isArray(genericRule) ? genericRule : [genericRule]).filter((rule) => rule.userAgent === "*").flatMap((rule) => (Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : []));
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

/*
  Whether a page opts itself out of search is a value in its head, so it is read as one.

  This was a regex over the page source -- `/robots:\s*\{[^}]*index:\s*false/` -- which is true
  for a metadata literal and false for every other way of writing the same fact. It went blind on
  the helper added in this same campaign: `pageMetadata({ index: false })` composes the `robots`
  object inside `lib/page-seo.ts`, so the page source carries no `robots:` text at all, the reader
  answered "indexable", and the guard whose whole job is to fail on a noindex page in the sitemap
  would have passed a draft in silence. The computed spelling a per-record page needs
  (`index: record.publication === "approved"`) is not readable from source in any form.

  So the page module is imported and its head evaluated: `metadata` where it is a static export,
  `generateMetadata` called with the params of this very path where it is not. Every page.tsx in
  the tree imports under vitest, a dynamic route's head is read for the slug the sitemap actually
  advertises, and a computed `index` is read as the boolean it evaluates to. The reads happen at
  module scope rather than inside a test so that no test's timeout is a cap on how many pages the
  suite may read.
*/
type PageModule = {
  metadata?: Metadata;
  generateMetadata?: (props: { params: Promise<Record<string, string | string[]>>; searchParams: Promise<Record<string, string>> }) => Metadata | Promise<Metadata>;
};

async function headOf(page: (typeof pages)[number], path: string): Promise<Metadata> {
  const pageModule = (await import(page.file)) as PageModule;
  if (pageModule.metadata) return pageModule.metadata;
  // A page that exports neither inherits the layout's head, which indexes.
  if (!pageModule.generateMetadata) return {};
  const values = (page.matcher.exec(path) ?? []).slice(1);
  const params = Object.fromEntries(page.params.map((param, index) => {
    const value = values[index] ?? "";
    return [param.name, param.catchAll ? value.split("/") : value];
  }));
  return await pageModule.generateMetadata({ params: Promise.resolve(params), searchParams: Promise.resolve({}) });
}

/*
  `/film` is noindex and advertised in neither file, so it is only readable here if this list
  names it -- and it is the positive control that keeps the reader honest without depending on
  what happens to be in llms.txt.
*/
/*
  The six draft cookbooks are advertised in none of the three files, so without this line no head
  is read for them and `isNoindex` throws rather than answering -- which is the right failure, and
  not one any assertion would reach. A draft is the case this reader exists for, so it is read.
*/
const READER_CONTROLS = [
  "/film",
  "/benchmarks",
  "/reproducibility",
  ...COOKBOOK_SLUGS.map((slug) => `/cookbooks/${slug}`),
];

const heads = new Map<string, Metadata>();
for (const path of new Set([...sitemapPaths, ...llmsPaths, ...READER_CONTROLS])) {
  const page = pages.find((candidate) => candidate.matcher.test(path));
  // An advertised path that resolves to no page is its own failure, asserted below. It must not
  // take the whole file down at collect time.
  if (page) heads.set(path, await headOf(page, path));
}

/* Next accepts `robots` as an object or as the raw string, and absent means indexable. */
function declaresNoindex(head: Metadata): boolean {
  const robots = head.robots;
  if (typeof robots === "string") return /\bnoindex\b/.test(robots);
  return robots?.index === false;
}

const isNoindex = (path: string) => {
  const head = heads.get(path);
  // No silent `false`. A reader that answers "indexable" for a path whose head it never read is
  // precisely the failure this replaced.
  if (!head) throw new Error(`${path} resolves to no page.tsx, so no head was read for it`);
  return declaresNoindex(head);
};

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
    expect(isNoindex("/film"), "a noindex page nothing advertises reads as indexable, so heads are not being read").toBe(true);
  });

  /*
    The integration the old source regex broke on, asserted on the two halves directly.

    The reader's input is whatever a page's head evaluates to, so `pageMetadata`'s spelling and a
    metadata literal are the same fact to it. Read from source they were not: the helper composes
    `robots` in `lib/page-seo.ts` and the calling page contains no `robots:` text, which made every
    helper-built draft read as indexable.
  */
  it("reads a head built by pageMetadata the same as a metadata literal", () => {
    const draft = { title: "Draft cookbook — TAVONEL", description: "A cookbook record that is not approved yet, described in a sentence long enough for a search result to print.", canonical: "/cookbooks/draft" };
    expect(declaresNoindex(pageMetadata({ ...draft, index: false })), "pageMetadata({ index: false }) does not read as noindex").toBe(true);
    expect(declaresNoindex(pageMetadata(draft)), "an approved record reads as noindex, so the reader refuses everything").toBe(false);
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

/*
  §12.1: only an approved page goes in the sitemap -- checked as the contradiction it produces
  rather than as a list of drafts.

  There is no publication flag in the content layer, and this campaign deliberately does not add
  one: a page that is not approved yet declares `robots: { index: false }` and stays out of
  `sitemap.ts`, and both change in the commit that approves it. What was missing is the direction
  nothing read. The guards above ask whether an advertised path exists and whether robots.txt
  withholds it; none of them asked whether the page itself says no. So a draft added to `ROUTES`
  by a hand that forgot the other half rendered a sitemap asking a crawler to index a page whose
  own head refuses, and every assertion in this file was green.

  That is the entire draft gate for `/cookbooks/[slug]`, whose records carry
  `publication: 'draft'`. It needs no new classification file -- `route-classification.json` is
  the CSRF credential matrix for API routes and has nothing to do with page publication -- and no
  new list here.
*/
describe("public surface: the sitemap advertises only approved pages", () => {
  it("lists no page that declares itself noindex", () => {
    const contradictions = sitemapPaths.filter((path) => isNoindex(path));
    expect(contradictions, "in the sitemap and noindex: the site asks a crawler to index a page whose own head refuses").toEqual([]);
  });

  /* The reader, both ways. A noindex test that stopped recognising noindex would pass everything. */
  it("still knows a noindex page when it reads one", () => {
    expect(isNoindex("/reproducibility"), "the standing noindex example no longer reads as noindex").toBe(true);
    expect(sitemapPaths).not.toContain("/reproducibility");
    expect(sitemapPaths).toContain("/ko");
  });

  /*
    The one place the llms.txt exemption must not reach.

    A noindex page is allowed in `llms.txt` -- `/reproducibility` is there on purpose, and the
    guard above admits exactly that case. A draft is different in kind: it is unapproved copy,
    not approved copy withheld from search, so advertising it to models is publishing it. The
    set below is empty until the cookbooks lane lands its six draft records, which makes this a
    gate rather than a measurement, and it is written as a gate on purpose.
  */
  it("offers a /cookbooks URL to models only once it is approved", () => {
    for (const path of [...new Set(llmsPaths)].filter((path) => path.startsWith("/cookbooks"))) {
      expect(isRealRoute(path), `${ORIGIN}${path} is in llms.txt but no page resolves it`).toBe(true);
      expect(sitemapPaths, `${ORIGIN}${path} is offered to models while it is still a draft`).toContain(path);
    }
  });
});

/*
  §12.4 -- the Korean subtree, and the three ways an hreflang scaffold is wrong.

  It can annotate a language the document does not declare, it can omit the page carrying it
  from its own alternate set, and it can be enforced by a redirect that hides the other language
  from the reader who wanted it. `lib/page-seo.ts` refuses the second at build time; the first
  and the third are facts about files, so they are read here.
*/
describe("public surface: the Korean subtree", () => {
  const koreanPages = pages.filter((page) => page.route === "/ko" || page.route.startsWith("/ko/"));

  it("is the one Korean URL this campaign ships, and it is approved", () => {
    expect(koreanPages.map((page) => page.route)).toEqual(["/ko"]);
    expect(sitemapPaths).toContain("/ko");
    expect(isNoindex("/ko")).toBe(false);
  });

/*
    B10 / seo-i18n CROSS-LANE 1 and 2, both of which land here because neither file is in a lane's
    row: `app/layout.tsx` carries the English half of the hreflang pair, and
    `lib/marketing-analytics.ts` is what decides where a consented page view is even possible.

    The pair is the point. `/ko` naming `/` as its English alternate is a claim a search engine may
    ignore when only one side annotates it, and a one-way annotation is not wrong -- it is
    incomplete in a way nothing on either side could see.
  */
  it("is named as the Korean alternate by the English entry page too", () => {
    const layout = readFileSync(join(appDirectory, "layout.tsx"), "utf8");
    expect(layout).toMatch(/languages:\s*\{[^}]*ko:\s*"\/ko"/);
    expect(layout).toMatch(/languages:\s*\{[^}]*en:\s*"\/"/);
    expect(layout).toMatch(/languages:\s*\{[^}]*"x-default":\s*"\/"/);
    expect(layout).toMatch(/canonical:\s*"\/"/);
  });

  it("can be measured at all, which needs its path on the consented set", () => {
    // Not a consent change: the set gates where a consented page view is possible, and a path
    // missing from it is a public page measured nowhere -- which is what /ko was.
    expect(publicPageLocation("/ko")).toBe("https://tavonel.com/ko");
    expect(publicPageLocation("/workspace"), "the set still refuses a private path").toBeNull();
  });

  it("declares Korean on the subtree it renders", () => {
    expect(readFileSync(join(appDirectory, "ko", "layout.tsx"), "utf8"), 'the /ko layout must carry lang="ko" -- the root layout says lang="en"').toMatch(/lang="ko"/);
  });

  it("names itself and the English entry in its own hreflang set", () => {
    const source = readFileSync(join(appDirectory, "ko", "page.tsx"), "utf8");
    expect(source).toMatch(/canonical:\s*"\/ko"/);
    expect(source).toMatch(/ko:\s*"\/ko"/);
    expect(source).toMatch(/en:\s*"\/"/);
    expect(source).toMatch(/"x-default":\s*"\/"/);
  });

  /*
    No forced geo redirect. `middleware.ts` mints a CSP nonce and routes nothing, and the build
    uses no Next `i18n` block -- which is the feature that would prefix and redirect every URL.
    A general 301 is not forbidden here; §12.1 asks for accurate ones. Sending a reader to a
    language because of where they connected from is what is forbidden.
  */
  it("sends nobody to a language they did not ask for", () => {
    const middleware = readFileSync(resolve(import.meta.dirname, "../middleware.ts"), "utf8");
    expect(middleware).not.toMatch(/NextResponse\.redirect|accept-language|acceptLanguage|locale/i);
    expect(readFileSync(resolve(import.meta.dirname, "../next.config.mjs"), "utf8")).not.toMatch(/\bi18n\b/);
  });
});

/*
  The six drafts, read the same way every other page is read.

  This is where the two lanes had to meet and where nothing would have caught them missing each
  other. The cookbooks lane asserts `noindex` with a regex over its own page source; that regex is
  true today and says nothing about the value Next actually puts in the head, which is the exact
  blindness the reader above was repaired for. The seo-i18n lane's guard reads evaluated heads, but
  only for paths one of the three public files advertises -- and a draft is advertised nowhere, so
  the six routes it was written to protect were the six it never looked at.

  So the cookbook paths join READER_CONTROLS and are asserted from the head: noindex per slug,
  absent from the sitemap, absent from llms.txt. The reader needed no extension for the dynamic
  route -- `headOf` already calls `generateMetadata` with the params of the path it was handed --
  and the canonical assertion below is what proves that rather than assuming it: a reader that
  evaluated the file once, for one slug, would return the same canonical six times.
*/
describe("public surface: the draft cookbooks", () => {
  const cookbookPaths = COOKBOOK_SLUGS.map((slug) => `/cookbooks/${slug}`);

  it("has one route and six records, and reads a head for each", () => {
    expect(pages.filter((page) => page.route.startsWith("/cookbooks")).map((page) => page.route)).toEqual([
      "/cookbooks/[slug]",
    ]);
    expect(cookbookPaths).toHaveLength(6);
    for (const path of cookbookPaths) expect(isRealRoute(path), path).toBe(true);
  });

  it.each(COOKBOOK_SLUGS)("/cookbooks/%s declares noindex in the head it renders", (slug) => {
    const path = `/cookbooks/${slug}`;
    expect(isNoindex(path), `${ORIGIN}${path} is a draft whose own head does not refuse indexing`).toBe(true);
    // Per URL, not per file: a reader that resolved the dynamic route once would answer the same
    // canonical for all six, and the guard would be reading one page's head six times.
    expect(heads.get(path)?.alternates?.canonical).toBe(path);
  });

  it("advertises none of them while every record is a draft", () => {
    const drafts = COOKBOOKS.filter((record) => record.publication === "draft").map((record) => `/cookbooks/${record.slug}`);
    expect(drafts).toEqual(cookbookPaths);
    expect(sitemapPaths.filter((path) => path.startsWith("/cookbooks"))).toEqual([]);
    expect(llmsPaths.filter((path) => path.startsWith("/cookbooks"))).toEqual([]);
  });

});
