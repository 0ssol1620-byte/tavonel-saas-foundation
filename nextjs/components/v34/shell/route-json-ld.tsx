import { jsonLdHtml } from "@/lib/structured-data";
import { routeJsonLd } from "@/lib/v34/route-metadata";
import type { V34RouteKey } from "@/lib/v34/routes";

/**
 * The structured data of a V34 route: WebSite on home, a BreadcrumbList below it, and an Article
 * only when the registry record carries real publication dates (`routeJsonLd` decides). The one
 * place a V34 page writes raw JSON-LD into the document: every page renders this, so the sink is
 * counted once, and its input is the registry record and nothing from a request.
 */
export default function RouteJsonLd({ route }: { route: V34RouteKey }) {
  return (
    <>
      {routeJsonLd(route).map((node, index) => (
        <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(node) }} />
      ))}
    </>
  );
}
