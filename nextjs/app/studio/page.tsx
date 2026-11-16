import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("studio");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("studio");
  return <RouteStub route="studio" line="The reference walkthrough steps through one fixed sample, from source file to cited answer." />;
}
