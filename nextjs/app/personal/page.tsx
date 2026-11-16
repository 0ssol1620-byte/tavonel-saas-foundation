import Personal from "@/components/v34/routes/personal/personal";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("personal");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("personal");
  return <Personal />;
}
