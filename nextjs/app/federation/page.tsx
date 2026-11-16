import Federation from "@/components/v34/routes/federation/federation";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("federation");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("federation");
  return <Federation />;
}
