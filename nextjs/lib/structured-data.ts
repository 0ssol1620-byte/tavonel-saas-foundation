/*
  §10 -- BreadcrumbList, and only BreadcrumbList.

  The global JSON-LD in `app/layout.tsx` is Organization + SoftwareApplication and stops there,
  deliberately: this deployment is a private pilot with no public catalogue, so `Offer` would
  describe a purchase that does not exist and `AggregateRating` a review nobody wrote. Neither is
  added here, and neither is `TechArticle` -- that schema requires `datePublished` and
  `dateModified`, and no page on this site carries a real publication date. A date invented to
  satisfy a schema is a fabricated fact with structured markup around it, which is worse than
  the missing schema.

  A breadcrumb is different in kind: it restates the URL hierarchy the site already has. It
  claims nothing that is not already true of the address bar.
*/
export type BreadcrumbStep = { name: string; path: string };

const ORIGIN = "https://tavonel.com";

/**
 * The serializer for every JSON-LD block this site emits.
 *
 * `JSON.stringify` escapes nothing HTML cares about, and both blocks reach the page through
 * `dangerouslySetInnerHTML`. Inside a `<script>` element the HTML parser is looking for exactly
 * one thing -- `</script` -- so one string value containing it ends the element early and
 * everything after it is markup on the page. `<` is the same character to a JSON parser and
 * is not `<` to the HTML parser, which is why escaping that one character is the whole fix.
 *
 * Nothing exploitable exists today: every value in either block is an authored literal and every
 * breadcrumb trail is a page-declared string. That is a property of today's callers, not of the
 * sink -- and the sink is what the next caller reaches for, with a cookbook title out of a
 * customer document or a connector's folder name. So the escaping is here, once, instead of at
 * whichever call site remembers it.
 */
export function jsonLdHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/*
  Home is prepended rather than repeated at nine call sites -- a trail that skips the root is a
  trail whose first item is not the first item, and that is exactly the sort of thing that is
  wrong on one page out of nine and nowhere else.
*/
export function breadcrumbList(trail: readonly BreadcrumbStep[]) {
  const steps: BreadcrumbStep[] = [{ name: "TAVONEL", path: "/" }, ...trail];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: steps.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: `${ORIGIN}${step.path === "/" ? "" : step.path}`,
    })),
  };
}
