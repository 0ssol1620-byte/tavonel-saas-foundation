import Company from "@/components/v34/routes/company/company";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

/*
  /company in the V34 frame: registry metadata, the release gate, then the body. The words of the
  page are in components/v34/routes/company/; the operator's details come from the operator record.
*/
export const metadata = routeMetadata("company");
export const viewport = routeViewport();

export default async function CompanyPage() {
  await releaseGate("company");
  return <Company />;
}
