import Film from "@/components/v34/routes/film/film";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

/*
  Held: the page answers 404 through releaseGate, like every held route, and the layout beside this
  file applies the same visibility rule. The page is a storyboard until a film capture and its rights
  exist; no video file is added.
*/
export const metadata = routeMetadata("film");
export const viewport = routeViewport();

export default async function Page() {
  await releaseGate("film");
  return <Film />;
}
