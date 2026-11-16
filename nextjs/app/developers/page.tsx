import Developers from "@/components/v34/routes/developers/developers";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("developers");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("developers");
  return <Developers />;
}
