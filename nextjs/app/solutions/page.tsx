// WO-PERF-4: product-polish.css is route-scoped (it left globals.css); keep it the first import so it loads before this route's other sheets.
import "@/app/product-polish.css";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { SolutionsBody } from "@/components/v34/routes/solutions/solutions";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

/*
  /solutions in V34: registry metadata, the release gate, then the body. The five workflow pages
  under /solutions/[slug] are unchanged; the body reads their SOLUTIONS record for its cards.

  The primary action is commercial state, resolved by `primaryCallToAction()` on the server, so the
  page renders on each request, as the home page does, and the label never swaps after hydration.
*/
export const metadata = routeMetadata("solutions");
export const viewport = routeViewport();
export const dynamic = "force-dynamic";

export default async function SolutionsPage() {
  await releaseGate("solutions");
  return (
    <V34Page route="solutions">
      <RouteJsonLd route="solutions" />
      <SolutionsBody />
    </V34Page>
  );
}
