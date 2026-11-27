// WO-PERF-4: product-polish.css is route-scoped (it left globals.css); keep it the first import so it loads before this route's other sheets.
import "@/app/product-polish.css";
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
