import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("journal-compiler");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("journal-compiler");
  return <RouteStub route="journal-compiler" line="A Knowledge Compiler turns documents into records with evidence, where search returns passages." />;
}
