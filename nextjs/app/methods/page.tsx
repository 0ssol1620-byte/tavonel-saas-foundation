import Methods from "@/components/v34/routes/methods/methods";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("methods");
export const viewport = routeViewport();
// The primary action is commercial state (self-serve or "Request access") read from the runtime's flags,
// so the page renders on each request, as the home page does, instead of freezing the build-time answer.
export const dynamic = "force-dynamic";

export default async function Page() {
  await releaseGate("methods");
  return <Methods />;
}
