import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";

export const metadata: Metadata = { title: "Documentation — TAVONEL", description: "Start compiling sources into a traceable Compiled World.", alternates: { canonical: "/docs" }, openGraph: { url: "/docs" } };

export default function DocsPage() {
  return <PublicPageShell><section className="scene doc"><div className="shell"><div className="body">
    <div className="stack"><p className="slate"><b>DOCUMENTATION</b><span />START HERE</p><h1 className="document-title">From sources to a Compiled World.</h1></div>
    <div className="stack"><p className="lede">Upload or connect qualified sources, review the preflight boundary, watch observed compile events, then inspect World evidence before using Ask or export.</p>
      <ol className="docs-steps"><li><b>Bring sources.</b> Add supported files, a folder, ZIP archive, or an available connection.</li><li><b>Confirm preflight.</b> Review files, pages, warnings, estimate, and maximum charge.</li><li><b>Compile.</b> Follow SOURCES, READ, STRUCTURE, and WORLD from persisted run events.</li><li><b>Inspect and use.</b> Review evidence, ask with citations, and download signed results.</li></ol>
      <div className="actions"><Link className="btn" href="/login">Open your workspace</Link><a className="btn ghost" href="/api">API reference</a></div>
    </div>
  </div></div></section></PublicPageShell>;
}
