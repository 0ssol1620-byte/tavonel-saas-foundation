import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("creators");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("creators");
  return <RouteStub route="creators" line="A creative World keeps the source of each fact beside it so a writer can check continuity." />;
}
