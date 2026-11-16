import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("autopilot");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("autopilot");
  return <RouteStub route="autopilot" line="Autopilot proposals wait for a person to review them before anything changes in a World." />;
}
