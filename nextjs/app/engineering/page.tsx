import Engineering from "@/components/v34/routes/engineering/engineering";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("engineering");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("engineering");
  return <Engineering />;
}
