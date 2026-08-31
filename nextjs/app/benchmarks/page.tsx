import type { Metadata } from "next";
import PublicProofRegistry from "@/components/public-proof-registry";

export const metadata: Metadata = { title: "Benchmark Registry — TAVONEL", description: "The public registry for reproduced, version-bound TAVONEL benchmark evidence.", alternates: { canonical: "/benchmarks" }, openGraph: { url: "/benchmarks" } };

export default function BenchmarksPage() {
  return <PublicProofRegistry eyebrow="BENCHMARK REGISTRY" title="A score arrives last." state="NO EXTERNAL SCORE PUBLISHED" summary="A result enters this registry only with frozen inputs, environment, evaluator, raw output and a reviewable receipt. Product existence is not benchmark evidence." sections={[
    { title: "Admission contract", body: "Every score must bind the model/runtime, dataset revision, preprocessing, evaluator and raw prediction archive.", rows: [
      { key: "INPUT", description: "Dataset license, revision, exclusions and SHA-256 inventory.", state: "REQUIRED" },
      { key: "RUNTIME", description: "Container or lockfile digest, hardware class and deterministic settings.", state: "REQUIRED" },
      { key: "SCORER", description: "Unmodified evaluator commit and complete command line.", state: "REQUIRED" },
      { key: "OUTPUT", description: "Raw predictions, logs, failures and machine-readable receipt.", state: "REQUIRED" },
    ] },
    { title: "Published runs", body: "No comparison is promoted from internal smoke evidence or a one-off successful document.", empty: "No external benchmark run currently satisfies the full admission contract. This registry will not convert internal fixtures, endpoint health, or anecdotal OCR success into a score." },
    { title: "Comparison policy", body: "Competitor names and relative claims remain absent until the same evaluator and frozen corpus are reproduced for every compared system.", rows: [
      { key: "BASELINE", description: "Same corpus and scorer, reproduced from a declared release.", state: "NOT YET" },
      { key: "TAVONEL", description: "Raw run bundle reviewed under the same contract.", state: "NOT YET" },
      { key: "TABLE", description: "Published only after both records are qualified.", state: "HELD" },
    ] },
  ]} />;
}
