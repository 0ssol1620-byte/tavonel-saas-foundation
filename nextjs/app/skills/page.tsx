import RouteStub from "@/components/v34/route-stub";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

export const metadata = routeMetadata("skills");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("skills");
  return <RouteStub route="skills" line="A Skill is a reusable procedure that follows a World as its source and leaves a record of what it read." />;
}
