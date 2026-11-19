import MarketsArticle from "@/components/v34/routes/journal-markets/markets-article";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal-markets");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal-markets");
  return <MarketsArticle />;
}
