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
  §88 -- search discovery is named explicitly, model training is not.

  OAI-SearchBot, PerplexityBot and Googlebot are the retrieval crawlers whose operators document
  a user-agent for search appearance, and each gets the same public/private split as `*`. The
  training tokens -- Google-Extended, GPTBot, CCBot and the rest -- are deliberately absent. That
  is an IP and legal decision, and a default written here would make it by accident.
*/
const SEARCH_CRAWLERS = ["OAI-SearchBot", "PerplexityBot", "Googlebot"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      ...SEARCH_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", disallow: [...PRIVATE_PATHS] })),
      { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] },
    ],
    sitemap: "https://tavonel.com/sitemap.xml",
    host: "https://tavonel.com",
  };
}
