"use client";

/**
 * W1-L7 asset preview: every capture and diagram at desktop and phone width, with motion on or
 * reduced. Lives under /dev, so app/dev/layout.tsx 404s it on VERCEL_ENV=production and marks it
 * noindex everywhere else -- the same gate the compile-stage harness uses. (A `_folder` would be
 * a Next private folder and never routable at all, which defeats a preview.)
 *
 * Not linked from anywhere.
 */

import { useState } from "react";
import CompilePipelineDiagram from "@/components/visuals/compile-pipeline-diagram";
import ProvenanceChainDiagram from "@/components/visuals/provenance-chain-diagram";
import TemporalLineageDiagram from "@/components/visuals/temporal-lineage-diagram";
import FailClosedGateDiagram from "@/components/visuals/fail-closed-gate-diagram";
import manifestJson from "@/public/visuals/MANIFEST.json";

type Capture = { file: string; surface: string; route: string; width: number; pixelWidth: number; pixelHeight: number; bytes: number; alt: string };
const manifest = manifestJson as unknown as { captures: Capture[] };

const DIAGRAMS = [
  ["compile-pipeline", CompilePipelineDiagram],
  ["provenance-chain", ProvenanceChainDiagram],
  ["temporal-lineage", TemporalLineageDiagram],
  ["fail-closed-gate", FailClosedGateDiagram],
] as const;

export default function VisualsPreview() {
  const [reduce, setReduce] = useState(false);
  const [run, setRun] = useState(0);
  return (
    <main data-motion={reduce ? "reduce" : undefined} style={{ padding: "24px 16px 64px", maxWidth: 1600, margin: "0 auto", background: "var(--tv-paper, #f5f3ee)", color: "var(--tv-ink, #15191d)" }}>
      <h1 style={{ fontSize: 22 }}>W1-L7 visuals preview</h1>
      <p>
        <label><input type="checkbox" checked={reduce} onChange={(event) => setReduce(event.target.checked)} /> Reduced motion</label>{" "}
        <button type="button" onClick={() => setRun(run + 1)}>Replay motion</button>
      </p>

      <h2 style={{ fontSize: 18, marginTop: 32 }}>Diagrams</h2>
      {DIAGRAMS.map(([name, Diagram]) => (
        <section key={`${name}-${run}`} data-visual={name} style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 15 }}>{name}</h3>
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div data-width="desktop" style={{ width: 1040, maxWidth: "100%" }}><Diagram /></div>
            <div data-width="phone" style={{ width: 358, maxWidth: "100%", outline: "1px dashed rgb(0 0 0 / .2)" }}><Diagram /></div>
          </div>
        </section>
      ))}

      <h2 style={{ fontSize: 18, marginTop: 48 }}>Captures</h2>
      <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 420px), 1fr))" }}>
        {manifest.captures.map((capture) => (
          <figure key={capture.file} style={{ margin: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a preview of the exact file, not an optimised derivative */}
            <img src={`/visuals/${capture.file}`} alt={capture.alt} width={capture.pixelWidth} height={capture.pixelHeight} style={{ width: "100%", height: "auto", border: "1px solid rgb(0 0 0 / .12)" }} loading="lazy" />
            <figcaption style={{ fontSize: 12 }}>{capture.file} · {capture.surface} · {capture.route} · {capture.width}px · {capture.bytes.toLocaleString("en-US")} B</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
