import Home from "@/components/v34/routes/home/home";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

/*
  The entry point, rebuilt as V34 (decision 11 keeps the Landing V2 components in the tree for
  rollback; nothing here imports them). A thin file: metadata and viewport from the registry, the
  release gate, then the body. Structured data is the root layout's `@graph` (Organization,
  WebSite, SoftwareApplication); the home route adds none of its own.

  The title is the registry's one named exception to " — TAVONEL": the home tab has no section to
  name, so it names the product and what it does (`TAVONEL — ` + BRAND_LINE.headline).

  The primary action is commercial state, not static content. `primaryCallToAction()` decides
  between self-serve and "Request access" from the deployed runtime's flags, and a prerendered
  page would freeze the build-time answer into the HTML. So the route renders on each request
  (the same reason the previous entry page was `force-dynamic`), and the CTA is resolved on the
  server, with no label swap after hydration.
*/
export const metadata = routeMetadata("home");
export const viewport = routeViewport();
export const dynamic = "force-dynamic";

export default async function HomePage() {
  await releaseGate("home");
  return <Home />;
}
