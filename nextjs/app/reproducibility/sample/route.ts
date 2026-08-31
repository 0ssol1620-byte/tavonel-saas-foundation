const manifest = {
  schema: "tavonel.public_reproducibility_manifest.v1",
  status: "deterministic_fixture_not_customer_proof",
  generatedFrom: "repository-pinned public proof assets",
  claimsExcluded: ["customer outcome", "independent benchmark", "human-approved world", "semantic correctness"],
  inputs: [
    { url: "/proof-collection/dart-jtc-page-1.pdf", sha256: "bbc9bcd5c5c3efce74755e451e04f62ca1ca97402a10908d309ba5645d63751a" },
    { url: "/proof-collection/dart-jtc-page-2.pdf", sha256: "cbcd0747921a49fc88420521e6d655ddfa0ee7febdc8895f204e61625c933ee6" },
    { url: "/proof-collection/dart-jtc-page-3.pdf", sha256: "2224c8c1ca8a0057992e1dba2605a7e5184edb22af820ab976ff6d900374ee53" },
  ],
  stages: ["browser_direct_quarantine", "content_disarm", "qualified_gpu_ocr", "candidate_compile", "human_review_required_for_promotion"],
} as const;

export function GET() {
  return Response.json(manifest, { headers: { "Cache-Control": "public, max-age=3600", "Content-Disposition": "attachment; filename=\"tavonel-reproducibility-manifest-v1.json\"", "X-Content-Type-Options": "nosniff" } });
}
