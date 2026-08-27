export const trialCreditPolicy = {
  enabled: false,
  credits: 2,
  expiresInDays: 7,
  maximumJobs: 1,
  reason: "Trial credits remain unavailable until verified identity, anti-abuse persistence, sanitized-only processing, and explicit activation approval are qualified.",
} as const;

export type TrialCreditPolicy = {
  enabled: boolean;
  credits: number;
  expiresInDays: number;
  maximumJobs: number;
  reason: string;
};

export type TrialCreditEligibilityInput = {
  identityVerified: boolean;
  identityPreviouslyReceivedTrial: boolean;
  workspacePreviouslyReceivedTrial: boolean;
};

export type TrialCreditDecision =
  | { allowed: false; code: "TRIAL_ISSUANCE_DISABLED" | "IDENTITY_VERIFICATION_REQUIRED" | "IDENTITY_TRIAL_ALREADY_ISSUED" | "WORKSPACE_TRIAL_ALREADY_ISSUED" }
  | { allowed: true; code: "ISSUE_TRIAL"; credits: number; maximumJobs: number; expiresInDays: number };

/**
 * Pure admission logic only. A future privileged ledger writer must atomically
 * persist the identity/workspace one-time markers before it creates a credit row.
 */
export function evaluateTrialCreditEligibility(
  input: TrialCreditEligibilityInput,
  policy: TrialCreditPolicy = trialCreditPolicy,
): TrialCreditDecision {
  if (!policy.enabled) return { allowed: false, code: "TRIAL_ISSUANCE_DISABLED" };
  if (!input.identityVerified) return { allowed: false, code: "IDENTITY_VERIFICATION_REQUIRED" };
  if (input.identityPreviouslyReceivedTrial) return { allowed: false, code: "IDENTITY_TRIAL_ALREADY_ISSUED" };
  if (input.workspacePreviouslyReceivedTrial) return { allowed: false, code: "WORKSPACE_TRIAL_ALREADY_ISSUED" };
  return {
    allowed: true,
    code: "ISSUE_TRIAL",
    credits: policy.credits,
    maximumJobs: policy.maximumJobs,
    expiresInDays: policy.expiresInDays,
  };
}

export function getTrialCreditReadiness(policy: TrialCreditPolicy = trialCreditPolicy) {
  return {
    status: policy.enabled ? "approval_required" : "fail_closed",
    credits: policy.credits,
    expiresInDays: policy.expiresInDays,
    maximumJobs: policy.maximumJobs,
    reason: policy.reason,
  } as const;
}
