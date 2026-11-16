import Teams from "@/components/v34/routes/teams/teams";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("teams");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("teams");
  return <Teams />;
}
