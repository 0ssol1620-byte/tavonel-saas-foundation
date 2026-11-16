import Community from "@/components/v34/routes/community/community";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("community");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("community");
  return <Community />;
}
