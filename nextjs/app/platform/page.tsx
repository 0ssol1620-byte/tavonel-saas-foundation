import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("platform");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("platform");
  return <RouteStub route="platform" line="Start from a document, follow it through compilation to a cited record, then read the finished World from an AI client." />;
}
