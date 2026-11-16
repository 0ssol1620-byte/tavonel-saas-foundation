import Marketplace from "@/components/v34/routes/marketplace/marketplace";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("marketplace");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("marketplace");
  return <Marketplace />;
}
