/*
  The closed list, and nothing else in the file.

  This is the light half of `lib/cookbook-content.ts`, split out for one measured reason. The
  carrier `lib/recipe-intent.ts` needs exactly two values from the cookbooks -- the six slugs and
  the recipe version -- and it is imported by `app/login/page.tsx` and `app/auth/callback/page.tsx`,
  both client components. Importing them from `cookbook-content.ts` pulled that module's own
  dependencies into both bundles: `lib/docs-content.ts` (72 KB of source) and
  `shared/capabilityManifest.ts`, for a six-string array. Measured with `next build`: `/login`
  112 -> 124 kB and `/auth/callback` 110 -> 123 kB of first-load JS, on a conversion page, with no
  budget watching either route.

  So the dependency is inverted rather than made lazy: the heavy module imports the light one and
  re-exports both values, and every existing importer of `cookbook-content.ts` keeps working. The
  list still has one owner -- this file -- and `lib/recipe-intent.test.ts` still asserts that
  `RECIPE_IDS`, `COOKBOOK_SLUGS` and `COOKBOOK_WORKFLOW_IDS` are the same six strings in the same
  order, which is the guard that stops the next author re-typing them.

  Nothing that describes a cookbook belongs here. A record, a section, a label or a sentence read
  out of the catalog or the manifest goes in `cookbook-content.ts`; this file holds identifiers.
*/

/**
 * The six priority packages, as a closed list.
 *
 * Also the recipe ids: a cookbook's CTA and the recipe a login round-trip preserves are the same
 * thing named twice.
 */
export const COOKBOOK_SLUGS = [
  "documents-to-grounded-work",
  "financial-report-figures-with-provenance",
  "manual-grounded-support-answers",
  "connect-external-ai-mcp-api",
  "portable-package-local-ai",
  "source-revision-reuse",
] as const;

export type CookbookSlug = (typeof COOKBOOK_SLUGS)[number];

/** The version a recipe intent carries. Moves when the recipe's steps change, not on an edit. */
export const RECIPE_VERSION = "2026-09-11";
