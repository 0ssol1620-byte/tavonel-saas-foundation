import Changes from "@/components/v34/routes/changes/changes";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("changes");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("changes");
  return <Changes />;
}
