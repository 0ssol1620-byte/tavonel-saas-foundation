import type { MetadataRoute } from "next";

/*
  The private surface. One list, four rules -- the generic crawler and the three named search
  crawlers get identical treatment, because a path that is private is private to all of them.

  `/benchmarks` and `/product/continuous-knowledge` used to be in this list. Both stopped being
  stubs in the Category Leadership campaign, both are in the sitemap, and `llms.txt` presents
  Benchmarks as a public destination -- so robots.txt was withholding two URLs the other two
  files advertised. The claim audit that gated their removal found no measured figure on either
  page: every quantity is a count of a structure printed beside it, and both pages state in their
  own copy that nothing on them is qualified. `lib/seo-surface.test.ts` now fails if the three
  files drift apart again.

  Robots is not access control. Every path below is enforced by authorization or by the route's
  own noindex; this list only spares a crawler the walk.

  Five of the ten are retired URLs rather than private ones: `/customers`, `/research/experiments`
  and `/film-2`, `/film-3`, `/film-4`. Each still has a `page.tsx` that calls `notFound()` and
  says so in its own comment, kept as a stable 404 for links published before the page was
  withdrawn. An audit read four of them as disallow lines pointing at nothing and proposed
  deleting the lines; they point at deliberate 404s, and the line is what stops a crawler
  re-walking a withdrawn URL on every pass. `lib/seo-surface.test.ts` now fails if a disallowed
  path resolves to no file at all, and fails if one of these stubs loses its retired annotation.
*/
const PRIVATE_PATHS = ["/api/", "/auth/", "/login", "/workspace", "/customers", "/research/experiments", "/film-2", "/film-3", "/film-4", "/dev/"];

/*
  §88 -- search discovery is named explicitly, and so is model training, in the opposite direction.

  OAI-SearchBot, PerplexityBot and Googlebot are the retrieval crawlers whose operators document
  a user-agent for search appearance, and each gets the same public/private split as `*`. Being
  findable is the point of this site; nothing here withholds a public page from a search crawler.
*/
const SEARCH_CRAWLERS = ["OAI-SearchBot", "PerplexityBot", "Googlebot"];

/* ─── TRAINING-CRAWLER BLOCK — begin (trust-policy lane; self-contained) ──────────────────────

  These tokens are disallowed everywhere. The decision is the founder's and the reasoning is in
  `docs/policy/CRAWLER_POLICY.md`: the repository is published for reading under a proprietary
  licence, the site's copy is the licensed work, and a corpus crawl is a different act from a
  search crawl even when the same company performs both.

  Search and training are separated by token, not by path, because that is the only distinction
  robots.txt can express. Two consequences a reader of this file must not lose:

  - **robots.txt is not access control.** Every line here is a request that an operator chooses to
    honour. It is not a technical measure, and it is not what makes the licence enforceable.
  - **This is not an SEO change.** Removing a token from this list gives away a licence position;
    adding one costs nothing in search. `lib/seo-surface.test.ts` pins both groups so neither
    drifts into the other, and so a search crawler cannot arrive in this list by copy-paste.

  The list is exactly what the founder named on 2026-09-11. Notably absent: `ClaudeBot`, which is
  the token Anthropic's current crawler sends -- `anthropic-ai` is the older one. Whether to add it
  is a founder decision and it is recorded as open in the crawler policy, not defaulted here.
*/
const TRAINING_CRAWLERS = ["GPTBot", "CCBot", "anthropic-ai", "Google-Extended", "Applebot-Extended"];
/* ─── TRAINING-CRAWLER BLOCK — end ────────────────────────────────────────────────────────────── */

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      ...SEARCH_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", disallow: [...PRIVATE_PATHS] })),
      { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] },
      // TRAINING-CRAWLER BLOCK: disallow-all, one rule per token. Nothing else reads this list.
      ...TRAINING_CRAWLERS.map((userAgent) => ({ userAgent, disallow: "/" })),
    ],
    sitemap: "https://tavonel.com/sitemap.xml",
    host: "https://tavonel.com",
  };
}
