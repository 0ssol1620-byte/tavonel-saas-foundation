import ResearchArticle from "@/components/v34/routes/journal-research/research-article";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal-research");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal-research");
  return <ResearchArticle />;
}
