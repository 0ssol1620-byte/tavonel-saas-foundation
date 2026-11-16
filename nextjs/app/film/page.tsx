import Film from "@/components/v34/routes/film/film";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

/*
  Held: production answers 404 from the layout beside this file (`VERCEL_ENV === "production"`), so
  this page carries no gate call of its own. The page is a storyboard until a film capture and its rights
  exist; no video file is added.
*/
export const metadata = routeMetadata("film");
export const viewport = routeViewport();

export default function Page() {
  return <Film />;
}
