import Creators from "@/components/v34/routes/creators/creators";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("creators");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("creators");
  return <Creators />;
}
