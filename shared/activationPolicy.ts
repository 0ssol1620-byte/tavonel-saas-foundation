export const activationPolicy = {
  customerIntake: {
    enabled: false,
    reason: "The legacy root runtime is not a production intake path. Production intake is owned by the separately deployed Next.js policy.",
  },
  cdr: {
    enabled: false,
    reason: "The legacy root runtime has no CDR authority. Production CDR is owned by the separately deployed Next.js policy.",
  },
  ocrGpu: {
    enabled: false,
    reason: "The legacy root runtime has no GPU dispatch authority. Production OCR is owned by the separately deployed Next.js policy.",
  },
  candidatePromotion: {
    enabled: false,
    reason: "Candidate promotion remains disabled pending explicit human approval.",
  },
} as const;

export type ActivationCapability = keyof typeof activationPolicy;

export function getActivationReadiness() {
  return Object.entries(activationPolicy).map(([capability, state]) => ({
    capability: capability as ActivationCapability,
    ...state,
  }));
}

export function isCapabilityEnabled(capability: ActivationCapability) {
  return activationPolicy[capability].enabled;
}
