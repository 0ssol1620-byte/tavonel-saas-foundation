import { describe, expect, it } from "vitest";
import {
  evaluateTrialCreditEligibility,
  getTrialCreditReadiness,
  trialCreditPolicy,
  type TrialCreditPolicy,
} from "../../shared/trialCredits";

const qualifiedTrialPolicy: TrialCreditPolicy = {
  ...trialCreditPolicy,
  enabled: true,
};

describe("trial credit admission", () => {
  it("keeps trial issuance fail-closed before activation", () => {
    expect(trialCreditPolicy.enabled).toBe(false);
    expect(
      evaluateTrialCreditEligibility({
        identityVerified: true,
        identityPreviouslyReceivedTrial: false,
        workspacePreviouslyReceivedTrial: false,
      }),
    ).toEqual({ allowed: false, code: "TRIAL_ISSUANCE_DISABLED" });
    expect(getTrialCreditReadiness()).toMatchObject({
      status: "fail_closed",
      credits: 2,
      expiresInDays: 7,
      maximumJobs: 1,
    });
  });

  it("requires a verified identity and one-time identity/workspace evidence", () => {
    expect(
      evaluateTrialCreditEligibility(
        { identityVerified: false, identityPreviouslyReceivedTrial: false, workspacePreviouslyReceivedTrial: false },
        qualifiedTrialPolicy,
      ),
    ).toEqual({ allowed: false, code: "IDENTITY_VERIFICATION_REQUIRED" });
    expect(
      evaluateTrialCreditEligibility(
        { identityVerified: true, identityPreviouslyReceivedTrial: true, workspacePreviouslyReceivedTrial: false },
        qualifiedTrialPolicy,
      ),
    ).toEqual({ allowed: false, code: "IDENTITY_TRIAL_ALREADY_ISSUED" });
    expect(
      evaluateTrialCreditEligibility(
        { identityVerified: true, identityPreviouslyReceivedTrial: false, workspacePreviouslyReceivedTrial: true },
        qualifiedTrialPolicy,
      ),
    ).toEqual({ allowed: false, code: "WORKSPACE_TRIAL_ALREADY_ISSUED" });
  });

  it("limits a future qualified grant to two credits and one job", () => {
    expect(
      evaluateTrialCreditEligibility(
        { identityVerified: true, identityPreviouslyReceivedTrial: false, workspacePreviouslyReceivedTrial: false },
        qualifiedTrialPolicy,
      ),
    ).toEqual({ allowed: true, code: "ISSUE_TRIAL", credits: 2, maximumJobs: 1, expiresInDays: 7 });
  });
});
