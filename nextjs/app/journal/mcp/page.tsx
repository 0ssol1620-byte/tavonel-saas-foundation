import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal-mcp");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal-mcp");
  return <RouteStub route="journal-mcp" line="MCP defines how an AI client reads a World through read-only tools." />;
}
