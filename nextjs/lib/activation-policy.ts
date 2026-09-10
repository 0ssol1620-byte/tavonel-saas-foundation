/*
  Every `reason` here is public copy. It is rendered on /security and served verbatim from
  /api/status, so a reader takes it as the deployment's own statement about itself.

  Two of them used to cite an internal receipt: intake "approved after synthetic R2
  qualification", and GPU OCR "release-qualified from the recorded 2026-08-29 full-sequence
  evidence". Both records exist -- `docs/FOUNDATION_R2_SYNTHETIC_CANARY_2026-08-29.md` and
  `docs/evidence/ocr/FOUNDATION_GPU_OCR_FULL_SEQUENCE_2026-08-29.{md,json}` -- and neither is
  served by this site or publishable as it stands: between them they carry a deployment id, a
  RunPod endpoint id, an account balance, a committer's email address and the internal FOLYNTA
  name. So each citation was a dated claim the reader had no way to check, which is exactly the
  shape RESOLVED A-6 (2026-09-06) removes: link the evidence, or drop the mention rather than
  leave it standing unlinked.

  Dropping it costs nothing true. What a security page owes a reader is which controls are
  enforced right now, and those are still stated. Whether a redacted public evidence page should
  carry these receipts is a founder decision, not one this string can make on its own.

  Repair, 2026-09-06. Only the intake citation was actually dropped. The OCR one was reworded
  into "The record that qualified it is an internal release record and is not published here."
  -- the same shape A-6 removes, one step worse: it tells the reader a qualifying record exists
  and then withholds it, so it can be neither checked nor argued with, and the inverted test
  below was written narrowly enough to let it through. It is gone now rather than reworded, and
  the two enforced controls are the whole of what the string claims.
*/
export const activationPolicy = {
  customerIntake: { enabled: true, reason: "Customer intake is open. Files go to the TAVONEL quarantine bucket before processing, and no other part of the deployment reads them there." },
  /*
    C-13 names the path that is actually carrying production Worker traffic.

    The private PDFium/ClamAV revision was first exercised behind IAM with the same HMAC and
    digest checks as the Worker, then the exact zero-traffic Worker version was promoted after
    its repository checks passed. The public sentence states the controls a customer can rely on
    without publishing service names, image digests or broker identifiers. Customer-data
    activation stays a separate gate; this row describes the sanitizer path, not permission to
    send customer files through it.

    It deliberately avoids the word "qualification", which the A-6 rule in
    `activation-policy.test.ts` treats as a promise of a public receipt.
  */
  cdr: { enabled: true, reason: "Quarantine source objects are sanitized by an IAM-only PDFium and ClamAV service before anything downstream reads them. The production Worker uses short-lived workload identity, refuses redirects, and stores only digest-bound immutable PDFs for downstream reading." },
  ocrGpu: { enabled: true, reason: "GPU OCR is open, with scale-to-zero and candidate-only review controls enforced." },
  candidatePromotion: { enabled: false, reason: "Promotion is always an explicit human decision." },
  customerData: { enabled: false, reason: "Customer-data processing is gated until the security suite passes and the founder records an approval receipt." },
} as const;

export type ActivationCapability = keyof typeof activationPolicy;
export function allCapabilitiesFailClosed() { return Object.values(activationPolicy).every(capability => capability.enabled === false); }
