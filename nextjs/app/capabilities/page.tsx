import Capabilities from "@/components/v34/routes/capabilities/capabilities";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("capabilities");
export const viewport = routeViewport();
// The deployment table is read from the live status per request, like /studio and the home page.
export const dynamic = "force-dynamic";

export default async function Page() {
  await releaseGate("capabilities");
  return <Capabilities />;
}
