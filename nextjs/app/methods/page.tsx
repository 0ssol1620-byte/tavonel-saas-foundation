import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("methods");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("methods");
  return <RouteStub route="methods" line="The method runs from source file to evidence region to record to relationship, and each step is checked." />;
}
