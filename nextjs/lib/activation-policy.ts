export const activationPolicy = {
  customerIntake: { enabled: false, reason: "Synthetic R2 qualification and explicit activation approval are required." },
  cdr: { enabled: false, reason: "Independently authenticated CDR runtime qualification is required." },
  ocrGpu: { enabled: false, reason: "Only a sanitized-only candidate path may be qualified." },
  candidatePromotion: { enabled: false, reason: "Promotion is always an explicit human decision." },
} as const;

export type ActivationCapability = keyof typeof activationPolicy;
export function allCapabilitiesFailClosed() { return Object.values(activationPolicy).every(capability => capability.enabled === false); }
