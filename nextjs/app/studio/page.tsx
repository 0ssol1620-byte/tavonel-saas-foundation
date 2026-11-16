import Studio from "@/components/v34/routes/studio/studio";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("studio");
export const viewport = routeViewport();
// The primary action is commercial state (primaryCallToAction), resolved per request like the home page.
export const dynamic = "force-dynamic";

export default async function Page() {
  await releaseGate("studio");
  return <Studio />;
}
