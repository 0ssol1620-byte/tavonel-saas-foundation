import type { Metadata } from "next";
import PublicProofRegistry from "@/components/public-proof-registry";

export const metadata: Metadata = { title: "Customer Evidence — TAVONEL", description: "Consent-gated customer and design-partner evidence records for TAVONEL.", robots: { index: false, follow: false }, alternates: { canonical: "/customers" }, openGraph: { url: "/customers" } };

export default function CustomersPage() {
  return <PublicProofRegistry eyebrow="CUSTOMER EVIDENCE REGISTRY" title="A logo is a claim." state="NO PUBLIC CUSTOMER PROOF REGISTERED" summary="TAVONEL publishes a customer name, logo, quote or outcome only after the organization approves the exact asset, wording, scope and evidence record." sections={[
    { title: "Admission contract", body: "A design-partner record binds written consent to a specific public claim. General product access or a private pilot agreement is not marketing consent.", rows: [
      { key: "CONSENT", description: "Named approver, approved channels, assets, wording and expiry or revocation process.", state: "REQUIRED" },
      { key: "CLAIM", description: "Exact outcome statement with population, period, baseline and exclusions.", state: "REQUIRED" },
      { key: "EVIDENCE", description: "Reviewable source receipt that supports only the approved claim.", state: "REQUIRED" },
      { key: "REVIEW", description: "Customer and TAVONEL approval recorded before publication.", state: "HUMAN GATE" },
    ] },
    { title: "Published records", body: "No anonymous quote, invented logo strip, proxy metric or internal pilot result is substituted for customer evidence.", empty: "No customer or design-partner record is approved for public display. This state changes only after the consent and evidence contract is complete." },
  ]} />;
}
