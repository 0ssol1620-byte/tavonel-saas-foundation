import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("teams");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("teams");
  return <RouteStub route="teams" line="A shared World lets a group read and check the same compiled knowledge." />;
}
