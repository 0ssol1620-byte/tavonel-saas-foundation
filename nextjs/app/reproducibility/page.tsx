import type { Metadata } from "next";
import PublicProofRegistry from "@/components/public-proof-registry";

/*
  Noindex until there is a run to reproduce.

  Most of what this page could say is what is missing: there is no frozen container digest, no
  evaluator version and no raw predictions to hand a third party yet. Fixture identity is real
  and worth keeping for anyone who follows a link here from Resources, but a page whose largest
  section was an empty "No independent reproduction receipt is currently registered" panel
  should not be advertised to search. The index entry comes back when the bundle does.
*/
export const metadata: Metadata = { title: "Reproducibility — TAVONEL", description: "Frozen public fixtures and digest-bound sample artifacts for TAVONEL evidence.", alternates: { canonical: "/reproducibility" }, openGraph: { url: "/reproducibility" }, robots: { index: false, follow: true } };

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
  ]} />;
}
