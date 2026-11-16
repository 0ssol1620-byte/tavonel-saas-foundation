import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("trading");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("trading");
  return <RouteStub route="trading" line="A point-in-time question is answered from the evidence that existed on the chosen date." />;
}
