import type { Metadata } from "next";
import PublicProofRegistry from "@/components/public-proof-registry";

export const metadata: Metadata = { title: "Reproducibility — TAVONEL", description: "Inputs, digests, environment boundaries and downloadable manifests for public TAVONEL evidence.", alternates: { canonical: "/reproducibility" }, openGraph: { url: "/reproducibility" } };

export default function ReproducibilityPage() {
  return <PublicProofRegistry eyebrow="PUBLIC PROOF PROTOCOL" title="Rebuild the evidence, not the claim." state="FIXTURE VERIFIED · EXTERNAL BENCHMARK OPEN" summary="This portal separates deterministic public fixtures from customer proof and independent benchmark evidence. A digest proves bytes; it does not prove semantic quality." sections={[
    { title: "Frozen inputs", body: "The current downloadable manifest names three public proof PDFs already shipped with the product and pins each byte sequence by SHA-256.", rows: [
      { key: "INPUT 01", description: "dart-jtc-page-1.pdf · sha256:bbc9bcd5c5c3efce74755e451e04f62ca1ca97402a10908d309ba5645d63751a", state: "PUBLIC FIXTURE" },
      { key: "INPUT 02", description: "dart-jtc-page-2.pdf · sha256:cbcd0747921a49fc88420521e6d655ddfa0ee7febdc8895f204e61625c933ee6", state: "PUBLIC FIXTURE" },
      { key: "INPUT 03", description: "dart-jtc-page-3.pdf · sha256:2224c8c1ca8a0057992e1dba2605a7e5184edb22af820ab976ff6d900374ee53", state: "PUBLIC FIXTURE" },
    ], download: { href: "/reproducibility/sample", label: "Download reproducibility manifest" } },
    { title: "What it establishes", body: "The manifest establishes input identity, declared processing boundaries, and the URLs needed to rerun the public fixture. It does not represent a customer result, a human-approved World, or an external benchmark score.", rows: [
      { key: "BYTES", description: "Every input has an exact SHA-256 binding.", state: "QUALIFIED" },
      { key: "PIPELINE", description: "Quarantine, CDR, GPU OCR and candidate compilation are declared as separate stages.", state: "QUALIFIED PATH" },
      { key: "QUALITY", description: "Independent semantic correctness evaluation is not attached to this fixture.", state: "NOT YET" },
    ] },
    { title: "Portable sample World", body: "A deterministic JSON package mirrors the public Explore object, relation and page-region evidence. Its response carries a SHA-256 Content-Digest header so the downloaded bytes can be verified. It is unsigned and is not a promoted customer World.", download: { href: "/reproducibility/sample-world", label: "Download digest-bound sample World" } },
    { title: "Independent replay", body: "A third-party replay requires a frozen container digest, evaluator version, raw predictions and scorer output. Those artifacts are not yet published as a complete external bundle.", empty: "No independent reproduction receipt is currently registered. The absence is public rather than replaced with a proxy score." },
  ]} />;
}
