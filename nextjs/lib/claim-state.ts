export const CLAIM_STATE = {
  qualified: {
    label: "QUALIFIED",
    tone: "qualified",
    meaning: "Supported by current qualification evidence for the named scope.",
  },
  demonstrated: {
    label: "DEMONSTRATED",
    tone: "demonstrated",
    meaning: "Built and shown on a declared sample or controlled path; not a production qualification.",
  },
  research: {
    label: "RESEARCH FRONTIER",
    tone: "research",
    meaning: "An active research direction that is not a shipped production capability.",
  },
  humanGate: {
    label: "HUMAN GATE",
    tone: "human-gate",
    meaning: "A consequential state change requires an explicit human decision.",
  },
  blocked: {
    label: "BLOCKED",
    tone: "blocked",
    meaning: "The required evidence or live dependency is absent; the capability must not be claimed.",
  },
  unknown: {
    label: "STATUS UNKNOWN",
    tone: "unknown",
    meaning: "Current deployment state could not be read. This is never treated as available.",
  },
} as const;

export type ClaimStateKey = keyof typeof CLAIM_STATE;
export type ClaimState = (typeof CLAIM_STATE)[ClaimStateKey];

export const AFFIRMATIVE_CLAIM_STATES: ClaimStateKey[] = ["qualified"];

export function claimState(key: ClaimStateKey): ClaimState {
  return CLAIM_STATE[key];
}

export function isQualifiedClaim(key: ClaimStateKey): boolean {
  return AFFIRMATIVE_CLAIM_STATES.includes(key);
}
