import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("federation");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("federation");
  return <RouteStub route="federation" line="One World can cite records from another while each owner keeps control of their own sources." />;
}
