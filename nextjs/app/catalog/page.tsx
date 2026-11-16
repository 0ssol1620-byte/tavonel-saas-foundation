import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("catalog");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("catalog");
  return <RouteStub route="catalog" line="Each collection shows its source terms before it is added to a World." />;
}
