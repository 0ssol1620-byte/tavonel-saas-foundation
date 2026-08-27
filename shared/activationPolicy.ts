export const activationPolicy = {
  customerIntake: {
    enabled: false,
    reason: "Customer intake remains disabled pending synthetic qualification and explicit approval.",
  },
  cdr: {
    enabled: false,
    reason: "CDR invocation remains disabled pending independently authenticated runtime qualification.",
  },
  ocrGpu: {
    enabled: false,
    reason: "OCR and GPU candidate processing remain disabled pending sanitized-only qualification.",
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
