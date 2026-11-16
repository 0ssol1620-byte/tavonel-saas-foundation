import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("personal");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("personal");
  return <RouteStub route="personal" line="A personal World holds your own PDFs, and every answer links back to the page it came from." />;
}
