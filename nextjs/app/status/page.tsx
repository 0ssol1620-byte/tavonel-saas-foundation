import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import { readPublicOperations } from "@/lib/operations";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/status" },
  openGraph: { url: "/status" }, title: "Service status - TAVONEL" };
export default function StatusPage() { const status=readPublicOperations(); return <PolicyLayout label="SERVICE STATUS" title="TAVONEL service status" intro={<>Last checked {new Date(status.generatedAt).toLocaleString("en-GB", { timeZone: "Asia/Seoul" })} KST from the active production deployment.</>}>
  <div className="status-list">{Object.entries(status.components).map(([key,value]) => <article key={key} data-state={value.state}><span>{value.state.replaceAll("_", " ")}</span><h3>{key.replaceAll("_", " ")}</h3><p>{value.detail}</p></article>)}</div>
  <h3>Incident contact</h3><p>Report service impact to support@tavonel.com and security issues to security@tavonel.com. Do not include document contents in email.</p>
</PolicyLayout>; }
