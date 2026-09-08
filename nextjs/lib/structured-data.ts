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
