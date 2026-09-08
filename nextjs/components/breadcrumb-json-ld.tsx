import { breadcrumbList, type BreadcrumbStep } from "@/lib/structured-data";

/**
 * One emission point for the breadcrumb graph. Pages pass their own trail; the serialization,
 * the origin and the root step live here, so a page cannot ship a breadcrumb that disagrees
 * with the shape every other page uses.
 */
export default function BreadcrumbJsonLd({ trail }: { trail: readonly BreadcrumbStep[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbList(trail)) }} />;
}
