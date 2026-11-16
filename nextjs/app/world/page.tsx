import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("world");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("world");
  return <RouteStub route="world" line="Every relationship in the reference World links to the record and the source document it was read from." />;
}
