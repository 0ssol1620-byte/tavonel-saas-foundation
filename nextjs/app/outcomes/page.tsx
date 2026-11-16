import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("outcomes");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("outcomes");
  return <RouteStub route="outcomes" line="Each outcome report states what was measured, over what period and from which source." />;
}
