import Enterprise from "@/components/v34/routes/enterprise/enterprise";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

/*
  /enterprise in the V34 frame: registry metadata, the release gate, then the body. The words of
  the page are in components/v34/routes/enterprise/ and the provision rows in
  content/trust/provisions.ts. The workspace admin console that shares this folder
  (enterprise-console.tsx, served at /workspace/admin) is unchanged.
*/
export const metadata = routeMetadata("enterprise");
export const viewport = routeViewport();

export default async function EnterprisePage() {
  await releaseGate("enterprise");
  return <Enterprise />;
}
