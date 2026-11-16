import Autopilot from "@/components/v34/routes/autopilot/autopilot";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("autopilot");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("autopilot");
  return <Autopilot />;
}
