export const activationPolicy = {
  customerIntake: { enabled: true, reason: "Foundation private-pilot intake is approved after synthetic R2 qualification. Files go to the Foundation quarantine bucket only." },
  cdr: { enabled: true, reason: "Foundation CDR Worker sanitizes quarantine source objects via tavonel-cdr-synthetic and writes immutable PDFs." },
  ocrGpu: { enabled: true, reason: "Foundation RunPod GPU OCR is qualified by the 2026-08-29 browser-to-ocr.json full-sequence evidence. Scale-to-zero and candidate-only review remain enforced." },
  candidatePromotion: { enabled: false, reason: "Promotion is always an explicit human decision." },
} as const;

export type ActivationCapability = keyof typeof activationPolicy;
export function allCapabilitiesFailClosed() { return Object.values(activationPolicy).every(capability => capability.enabled === false); }
