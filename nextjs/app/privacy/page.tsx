import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import { LEGAL_EFFECTIVE_DATE } from "@/lib/operations";

export const metadata: Metadata = { title: "Privacy notice - TAVONEL", description: "How TAVONEL handles account, document, billing and inquiry data." };

export default function PrivacyPage() {
  return <PolicyLayout label="PRIVACY" title="Your documents are inputs, not training material." intro={<>This notice explains the actual Foundation private-pilot data path. Effective {LEGAL_EFFECTIVE_DATE}. TAVONEL does not sell personal data or use customer document contents to train shared models.</>}>
    <h2>What we collect</h2><p>Account identifiers from Google OAuth; workspace and entitlement metadata; source files you deliberately upload; derived OCR, citation and knowledge artifacts; security and operational logs; billing identifiers supplied by Paddle; and the name, work email and message you submit through the contact form.</p>
    <h2>Why we process it</h2><p>We process data to authenticate users, compile and return knowledge packages, secure and operate the service, provide support, prevent abuse, maintain transaction records and comply with law. We do not request sensitive source documents through the public inquiry form.</p>
    <h2>Storage and lifecycle</h2><p>Document bytes are stored in tenant-scoped Cloudflare R2 quarantine and immutable result paths, not in the application database. Supabase stores account, entitlement and proof metadata. Data remains until workspace deletion, a verified deletion request, or a legal retention duty applies. Backup remnants expire on the provider backup schedule. Automated lifecycle enforcement is a general-availability launch gate and the service is currently a controlled private pilot.</p>
    <h2>International processing</h2><p>Supabase is configured in Seoul. Vercel, Cloudflare, RunPod, Resend, Google and Paddle may process limited data through global infrastructure or support systems outside Korea. The exact processor, purpose and data category are listed on the subprocessors page. Cloudflare R2 location hints are best-effort and are not a promise of Korean data residency.</p>
    <h2>Your choices</h2><p>You may request access, correction, export, restriction or deletion by writing to <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a>. We verify the requester before acting. Security reports should go to <a href="mailto:security@tavonel.com">security@tavonel.com</a>.</p>
    <h2>Contact</h2><p>Privacy contact: privacy@tavonel.com. Service operator: TAVONEL Foundation private pilot, Republic of Korea. The legal operator name, business registration details and service address must be published before live paid sales open.</p>
  </PolicyLayout>;
}
