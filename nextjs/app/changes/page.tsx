import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("changes");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("changes");
  return <RouteStub route="changes" line="When a source is revised, the records that depend on it are recompiled and the difference between the two versions is listed." />;
}
