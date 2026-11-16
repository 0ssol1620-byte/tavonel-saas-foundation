import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal-markets");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal-markets");
  return <RouteStub route="journal-markets" line="A point-in-time answer needs the evidence that existed on that date." />;
}
