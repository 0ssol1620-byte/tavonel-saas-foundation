import Trading from "@/components/v34/routes/trading/trading";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("trading");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("trading");
  return <Trading />;
}
