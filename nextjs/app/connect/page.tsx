import Connect from "@/components/v34/routes/connect/connect";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("connect");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("connect");
  return <Connect />;
}
