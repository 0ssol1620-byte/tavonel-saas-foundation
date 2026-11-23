import Governance from "@/components/v34/routes/governance/governance";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("governance");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("governance");
  return <Governance />;
}
