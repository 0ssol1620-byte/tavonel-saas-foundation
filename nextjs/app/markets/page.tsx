import Markets from "@/components/v34/routes/markets/markets";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("markets");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("markets");
  return <Markets />;
}
