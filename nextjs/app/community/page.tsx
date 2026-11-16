import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("community");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("community");
  return <RouteStub route="community" line="Shared Worlds, MCP configurations and examples are collected in one place." />;
}
