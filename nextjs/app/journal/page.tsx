import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal");
  return <RouteStub route="journal" line="Each article lists the sources it relies on and links to the reference material behind it." />;
}
