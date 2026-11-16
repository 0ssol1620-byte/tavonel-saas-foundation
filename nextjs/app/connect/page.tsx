import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("connect");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("connect");
  return <RouteStub route="connect" line="A World is read through MCP tools that only read, using a sign-in that can be revoked at any time." />;
}
