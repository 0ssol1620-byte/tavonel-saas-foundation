import type { Metadata } from "next";
import PublicProofRegistry from "@/components/public-proof-registry";

export const metadata: Metadata = { title: "Enterprise Deployment — TAVONEL", description: "Deployment boundaries, identity, storage, compute and governance for TAVONEL enterprise evaluation.", alternates: { canonical: "/enterprise" } };

export default function EnterprisePage() {
  return <PublicProofRegistry eyebrow="ENTERPRISE DEPLOYMENT ARCHITECTURE" title="Control and content take different paths." state="REFERENCE ARCHITECTURE · DEPLOYMENT-SPECIFIC REVIEW" summary="This is a deterministic boundary diagram, not a certification or a promise that every deployment option is active. Tenant policy and runtime proof remain separate records." sections={[
    { title: "Content plane", body: "Source bytes move directly between the customer's browser or source agent and tenant-scoped object storage. The application issues a short-lived capability but does not proxy document bytes.", rows: [
      { key: "SOURCE", description: "Browser, mounted filesystem agent, or qualified OAuth connector.", state: "TENANT BOUNDARY" },
      { key: "QUARANTINE", description: "Immutable object prefix with content disarm before processing.", state: "QUALIFIED PATH" },
      { key: "COMPUTE", description: "RunPod GPU receives bounded sanitized inputs through the worker contract.", state: "POLICY-GATED" },
      { key: "WORLD", description: "Candidate package, evidence bindings and human promotion receipt.", state: "HUMAN GATE" },
    ] },
    { title: "Control plane", body: "Identity, billing, connector metadata, policy and audit records travel through authenticated tenant-scoped APIs. Cloud credentials and refresh tokens are referenced through an approved secret broker rather than stored in product rows.", rows: [
      { key: "IDENTITY", description: "Google OAuth for pilot access; SAML and SCIM activate only after provider verification.", state: "DEPLOYMENT-SPECIFIC" },
      { key: "SECRETS", description: "Opaque secret references; no credential value in connector configuration.", state: "FAIL CLOSED" },
      { key: "AUDIT", description: "Organization-scoped immutable events with bounded export.", state: "QUALIFIED CONTROL" },
      { key: "POLICY", description: "Retention, region, signing and recovery targets are recorded separately from enforcement proof.", state: "HUMAN GATE" },
    ] },
    { title: "Deployment decisions", body: "A production design review binds the actual cloud regions, networking, object lifecycle, secret manager, identity provider and recovery evidence.", rows: [
      { key: "SHARED", description: "Current SaaS deployment with tenant-scoped application and storage boundaries.", state: "AVAILABLE BY PLAN" },
      { key: "DEDICATED", description: "Dedicated deployment is not represented as active until infrastructure is provisioned and verified.", state: "NOT YET" },
      { key: "RESIDENCY", description: "Provider region configuration is not an absolute data-residency guarantee.", state: "REVIEW REQUIRED" },
    ] },
  ]} />;
}
