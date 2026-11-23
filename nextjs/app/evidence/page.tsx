import Evidence from "@/components/v34/routes/evidence/evidence";
import { sampleEvidencePage } from "@/lib/evidence-regions";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("evidence");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("evidence");
  return <Evidence view={sampleEvidencePage()} />;
}
