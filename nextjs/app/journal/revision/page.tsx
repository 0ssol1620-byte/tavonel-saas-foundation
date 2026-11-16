import RevisionArticle from "@/components/v34/routes/journal-revision/revision-article";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal-revision");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal-revision");
  return <RevisionArticle />;
}
