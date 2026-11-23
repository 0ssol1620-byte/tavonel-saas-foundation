import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ResearchBody } from "@/components/v34/routes/research/research";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

/*
  /research is the researcher page (the registry's "research" route). The research program that
  used to be this page's body lives at /research/program.

  The primary action is commercial state, resolved by `primaryCallToAction()` on the server, so the
  page renders on each request, as the home page does, and the label never swaps after hydration.
*/
export const metadata = routeMetadata("research");
export const viewport = routeViewport();
export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  await releaseGate("research");
  return (
    <V34Page route="research">
      <RouteJsonLd route="research" />
      <ResearchBody />
    </V34Page>
  );
}
