import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("compiler");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("compiler");
  return <RouteStub route="compiler" line="The compiler reads a source file into records, attaches the evidence region for each one and checks the result against the source." />;
}
