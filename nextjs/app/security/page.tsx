import Security from "@/components/v34/routes/security/security";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

/*
  /security in the V34 frame: registry metadata, the release gate, then the body. The words of the
  page are in components/v34/routes/security/ and the provision rows in content/trust/provisions.ts.
*/
export const metadata = routeMetadata("security");
export const viewport = routeViewport();

export default async function SecurityPage() {
  await releaseGate("security");
  return <Security />;
}
