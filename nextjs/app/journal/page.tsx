import Journal from "@/components/v34/routes/journal/journal";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal");
  return <Journal />;
}
