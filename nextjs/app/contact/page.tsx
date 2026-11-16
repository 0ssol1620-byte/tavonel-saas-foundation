import Contact from "@/components/v34/routes/contact/contact";
import { releaseGate } from "@/lib/v34/release";
import { routeMetadata, routeViewport } from "@/lib/v34/route-metadata";

/*
  /contact in the V34 frame: registry metadata, the release gate, then the body. The form and the
  route it posts to are the ones the page already had; the words are in components/v34/routes/contact/.
*/
export const metadata = routeMetadata("contact");
export const viewport = routeViewport();

export default async function ContactPage() {
  await releaseGate("contact");
  return <Contact />;
}
