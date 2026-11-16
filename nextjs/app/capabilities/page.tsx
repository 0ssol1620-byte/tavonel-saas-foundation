import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("capabilities");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("capabilities");
  return <RouteStub route="capabilities" line="Each capability is listed with its current state, shipped or direction." />;
}
