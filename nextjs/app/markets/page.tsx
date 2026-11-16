import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("markets");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("markets");
  return <RouteStub route="markets" line="A compiled sample of filings lets you follow each figure to the filing that states it." />;
}
