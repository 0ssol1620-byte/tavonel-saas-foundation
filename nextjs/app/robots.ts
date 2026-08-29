import type { MetadataRoute } from "next";

/**
 * Indexing policy: closed.
 *
 * There was no policy at all, which meant the default -- crawlable. This deployment is a private
 * pilot that admits testing-mode users only, so being findable in a search result offers nothing
 * and invites sign-in attempts that are guaranteed to fail. Closed is also the reversible
 * direction: opening later is one line, while un-indexing a page that was crawled is not.
 *
 * When the pilot opens up, change `disallow` to the paths that should stay private -- at minimum
 * `/workspace` and `/auth` -- rather than deleting this file.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
