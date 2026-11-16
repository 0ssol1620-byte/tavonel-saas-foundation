import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("company");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("company");
  return <RouteStub route="company" line="TAVONEL compiles documents into Worlds that an AI can cite, and publishes the documents that govern their use." />;
}
