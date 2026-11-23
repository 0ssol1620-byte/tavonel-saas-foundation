import Outcomes from "@/components/v34/routes/outcomes/outcomes";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("outcomes");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("outcomes");
  return <Outcomes />;
}
