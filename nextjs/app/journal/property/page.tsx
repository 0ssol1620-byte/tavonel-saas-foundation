import PropertyArticle from "@/components/v34/routes/journal-property/property-article";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal-property");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal-property");
  return <PropertyArticle />;
}
