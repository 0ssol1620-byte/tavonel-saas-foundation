import McpArticle from "@/components/v34/routes/journal-mcp/mcp-article";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal-mcp");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal-mcp");
  return <McpArticle />;
}
