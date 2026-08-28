export const activationPolicy = {
  customerIntake: { enabled: true, reason: "Foundation private-pilot intake is approved after synthetic R2 qualification. Files go to the Foundation quarantine bucket only." },
  cdr: { enabled: true, reason: "Foundation CDR Worker sanitizes quarantine source objects via tavonel-cdr-synthetic and writes immutable PDFs." },
  ocrGpu: { enabled: false, reason: "OCR worker image is in-repo (workers/foundation-ocr, port 8001) pending a GHCR digest and a $5 no-SSH one-shot. GPU dispatch stays closed until that digest and capacity exist." },
  candidatePromotion: { enabled: false, reason: "Promotion is always an explicit human decision." },
} as const;

export type ActivationCapability = keyof typeof activationPolicy;
export function allCapabilitiesFailClosed() { return Object.values(activationPolicy).every(capability => capability.enabled === false); }
