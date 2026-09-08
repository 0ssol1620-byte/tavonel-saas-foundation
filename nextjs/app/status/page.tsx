import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import { readPublicOperations } from "@/lib/operations";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/status" },
  openGraph: { url: "/status" },
  title: "Service status — TAVONEL",
  description: "Component-by-component state of the active TAVONEL deployment, with the addresses to report service impact and security issues to.",
};
/*
  A named month, because 08/09/2026 is two different dates.

  `toLocaleString("en-GB")` printed "08/09/2026, 11:34:40" -- day-first, which a US or Korean
  reader reads month-first, turning today's live check into a month-old one or the reverse.
  RESOLVED A-6 says /status may not show a misleading state, and a freshness stamp a reader can
  misdate by four weeks is exactly that. Naming the month removes the ambiguity in every locale
  without changing the value or the timezone.
*/
const CHECKED_AT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

export default function StatusPage() { const status=readPublicOperations(); return <PolicyLayout label="SERVICE STATUS" title="TAVONEL service status" intro={<>Last checked {CHECKED_AT.format(new Date(status.generatedAt))} KST from the active production deployment.</>}>
  <div className="status-list">{Object.entries(status.components).map(([key,value]) => <article key={key} data-state={value.state}><span>{value.state.replaceAll("_", " ")}</span><h3>{key.replaceAll("_", " ")}</h3><p>{value.detail}</p></article>)}</div>
  <h3>Incident contact</h3><p>Report service impact to support@tavonel.com and security issues to security@tavonel.com. Do not include document contents in email.</p>
</PolicyLayout>; }
