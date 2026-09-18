import Link from "next/link";
import type { Route } from "next";
import { breadcrumbList, jsonLdHtml, type BreadcrumbStep } from "@/lib/structured-data";

/**
 * One emission point for the breadcrumb graph. Pages pass their own trail; the serialization,
 * the origin and the root step live here, so a page cannot ship a breadcrumb that disagrees
 * with the shape every other page uses.
 */
export default function BreadcrumbJsonLd({ trail }: { trail: readonly BreadcrumbStep[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbList(trail)) }} />;
}

/**
 * The same trail, rendered for the reader (BQ-137).
 *
 * Every reference route already declared its trail for a crawler and showed the reader nothing,
 * or -- on the two /product detail pages -- hand-rolled a second copy of it in a paragraph that
 * could drift from the first. `DocBreadcrumb` takes the identical `trail` array, so the machine
 * graph and the visible path are the same declaration rather than two that agree today.
 *
 * The last step is the page you are on: it is the trail's own label, not a link, because a link
 * to the current page is a control that does nothing. Every earlier step is a real link, and the
 * separators are `aria-hidden` so the accessible name is the list of page names.
 */
export function DocBreadcrumb({ trail }: { trail: readonly BreadcrumbStep[] }) {
  return (
    <nav className="doc-breadcrumb" aria-label="Breadcrumb">
      <ol>
        {trail.map((step, index) => (
          <li key={step.path}>
            {index === trail.length - 1 ? (
              <span aria-current="page">{step.name}</span>
            ) : (
              <>
                <Link href={step.path as Route}>{step.name}</Link>
                <span aria-hidden="true">/</span>
              </>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
