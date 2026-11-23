import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("billing");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("billing");
  return <RouteStub route="billing" line="Credits pay for the pages a compile reads, and the balance is checked before a compile starts." />;
}
