import Realestate from "@/components/v34/routes/realestate/realestate";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("realestate");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("realestate");
  return <Realestate />;
}
