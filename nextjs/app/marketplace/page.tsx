import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("marketplace");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("marketplace");
  return <RouteStub route="marketplace" line="Terms and source rights are shown before a World is acquired." />;
}
