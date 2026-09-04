export const activationPolicy = {
  customerIntake: { enabled: true, reason: "Customer intake is approved after synthetic R2 qualification. Files go to the TAVONEL quarantine bucket before processing." },
  cdr: { enabled: true, reason: "The CDR worker sanitizes quarantine source objects and writes immutable PDFs before downstream reading." },
  ocrGpu: { enabled: true, reason: "GPU OCR is release-qualified with scale-to-zero and candidate-only review controls enforced." },
  candidatePromotion: { enabled: false, reason: "Promotion is always an explicit human decision." },
} as const;

export type ActivationCapability = keyof typeof activationPolicy;
export function allCapabilitiesFailClosed() { return Object.values(activationPolicy).every(capability => capability.enabled === false); }
