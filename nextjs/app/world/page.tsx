import World from "@/components/v34/routes/world/world";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("world");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("world");
  return <World />;
}
