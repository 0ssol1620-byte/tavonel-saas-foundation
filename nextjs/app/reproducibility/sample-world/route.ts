import { createHash } from "node:crypto";

export const runtime = "nodejs";

const sampleWorld = {
  schema: "tavonel.public_sample_world.v1",
  disclosure: "deterministic_product_sample_not_customer_proof",
  world: { id: "sample-policy", revision: 3, lifecycle: "deterministic_sample" },
  source: { id: "sample-retention-policy", versionId: "src_v_01", filename: "sample-retention-policy.pdf", page: 4, bbox1000: [118, 214, 886, 374] },
  objects: [
    { id: "claim-retention", type: "claim", label: "Retention defaults to 30 days", state: "qualified", evidenceRefs: ["ev-01"] },
    { id: "policy-export", type: "policy", label: "Administrators can shorten retention", state: "qualified", evidenceRefs: ["ev-02"] },
    { id: "research-impact", type: "research", label: "Selective downstream impact path", state: "research_frontier", evidenceRefs: [] },
  ],
  evidence: [
    { id: "ev-01", sourceVersionId: "src_v_01", page: 4, bbox1000: [118, 214, 886, 374], excerpt: "Uploaded source material is retained for a default period of thirty days after a compile completes." },
    { id: "ev-02", sourceVersionId: "src_v_01", page: 4, bbox1000: [118, 214, 886, 374], excerpt: "Workspace administrators may configure a shorter retention period." },
  ],
} as const;

export function GET() {
  const body = `${JSON.stringify(sampleWorld, null, 2)}\n`;
  const digest = createHash("sha256").update(body).digest("base64");
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "attachment; filename=\"tavonel-public-sample-world-v1.json\"", "Content-Digest": `sha-256=:${digest}:`, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}