import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal-research");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal-research");
  return <RouteStub route="journal-research" line="Each claim about the TRAPPIST-1 planets keeps a link to the paper that supports it." />;
}
