import type { Metadata } from "next";
import PublicProofRegistry from "@/components/public-proof-registry";

export const metadata: Metadata = { title: "Experiment Archive — TAVONEL", description: "Failed hypotheses and research-frontier work, separated from qualified product claims.", alternates: { canonical: "/research/experiments" }, openGraph: { url: "/research/experiments" } };

export default function ExperimentsPage() {
  return <PublicProofRegistry eyebrow="FAILED EXPERIMENT ARCHIVE" title="What did not earn a claim." state="RESEARCH FRONTIER" summary="Failure records require the same provenance discipline as successful runs. A planned experiment is not rewritten as a failed one simply to make the archive look populated." sections={[
    { title: "Archive contract", body: "A failed experiment record must contain a falsifiable hypothesis, immutable inputs, environment digest, observed output, stop condition and disposition.", rows: [
      { key: "HYPOTHESIS", description: "A statement that the run can actually disprove.", state: "REQUIRED" },
      { key: "EVIDENCE", description: "Raw output and evaluator receipt, retained even when unfavorable.", state: "REQUIRED" },
      { key: "DISPOSITION", description: "Rejected, inconclusive, superseded or queued for replication.", state: "REQUIRED" },
    ] },
    { title: "Qualified failures", body: "Existing research copy names unclosed work, not completed failed experiments. We preserve that distinction here.", empty: "No evidence-backed failed experiment bundle is currently published. Selective recompilation remains a fixture demonstration, and retrieval comparisons remain unsupported until a frozen baseline is reproduced." },
    { title: "Open hypotheses", body: "These labels are public boundaries, not roadmap promises.", rows: [
      { key: "RECOMPILE", description: "Impact-aware selective recompilation beyond deterministic fixtures.", state: "IN PROGRESS" },
      { key: "RETRIEVAL", description: "External baseline comparison under a frozen evaluator.", state: "NOT SUPPORTED" },
      { key: "SEMANTICS", description: "Independent correctness benchmark for entity and relation construction.", state: "BUILT, NOT PROVEN" },
    ] },
  ]} />;
}