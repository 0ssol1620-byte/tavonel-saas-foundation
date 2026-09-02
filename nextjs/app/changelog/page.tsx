import type { Metadata } from "next";
import { PublicPageShell } from "@/components/public-page-shell";

export const metadata: Metadata = { title: "Changelog — TAVONEL", description: "Verified changes to the TAVONEL product and public interfaces.", alternates: { canonical: "/changelog" }, openGraph: { url: "/changelog" } };

export default function ChangelogPage() {
  return <PublicPageShell><section className="scene doc"><div className="shell"><div className="body">
    <div className="stack"><p className="slate"><b>CHANGELOG</b><span />PRODUCT</p><h1 className="document-title">What changed, without the noise.</h1></div>
    <div className="stack"><article className="policy-section"><time dateTime="2026-09-02">September 2, 2026</time><h2>Final product flow</h2><p>The public journey now follows five scenes: input, compilation, evidence, and a direct path into the Workspace. Pricing uses pages and dollars, while the API contract remains available as a noindex machine document.</p></article><article className="policy-section"><time dateTime="2026-09-01">September 1, 2026</time><h2>Run event ledger and page-based quotes</h2><p>Compile progress is derived from persisted events and page estimates now show both standard and maximum processing boundaries.</p></article></div>
  </div></div></section></PublicPageShell>;
}
