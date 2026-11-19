import Catalog from "@/components/v34/routes/catalog/catalog";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("catalog");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("catalog");
  return <Catalog />;
}
