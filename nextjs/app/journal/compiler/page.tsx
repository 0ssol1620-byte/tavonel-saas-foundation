import CompilerArticle from "@/components/v34/routes/journal-compiler/compiler-article";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal-compiler");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal-compiler");
  return <CompilerArticle />;
}
