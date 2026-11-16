import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("realestate");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("realestate");
  return <RouteStub route="realestate" line="Each property fact links back to the page of the document it was read from." />;
}
