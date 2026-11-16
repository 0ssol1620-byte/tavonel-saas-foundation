import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal-property");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal-property");
  return <RouteStub route="journal-property" line="Deeds, surveys and inspection reports become records that keep a link to their page." />;
}
