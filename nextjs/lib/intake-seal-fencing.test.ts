import { describe, expect, it } from "vitest";
import { foundationTriageSealObjectKey, validateFoundationTriageSealClaim } from "./intake-seal-fencing";

const workspaceKey = "pilot-test";
const actorUserId = "11111111-1111-4111-8111-111111111111";
const stageId = "22222222-2222-4222-8222-222222222222";
const preflightApprovalId = "55555555-5555-4555-8555-555555555555";
const tokenA = "33333333-3333-4333-8333-333333333333";
const tokenB = "44444444-4444-4444-8444-444444444444";
const now = Date.parse("2026-10-04T12:00:00Z");

function claim(sealToken: string, fenceGeneration: number) {
  return {
    stageId, preflightApprovalId, workspaceKey, actorUserId, state: "sealing", sealToken,
    documentId: sealToken, fenceGeneration,
    sealedSourceKey: `quarantine/${workspaceKey}/${sealToken}/source`,
    sealLeaseUntil: "2026-10-04T12:01:00Z", relativePath: "reports/report.pdf",
    declaredMimeType: "application/pdf", requestedBytes: 4096,
  };
}

describe("durable triage seal fencing", () => {
  it("allocates disjoint final keys for concurrent and late attempts", () => {
    const keyA = foundationTriageSealObjectKey(workspaceKey, tokenA);
    const keyB = foundationTriageSealObjectKey(workspaceKey, tokenB);
    expect(keyA).toBe(`quarantine/${workspaceKey}/${tokenA}/source`);
    expect(keyB).toBe(`quarantine/${workspaceKey}/${tokenB}/source`);
    expect(keyA).not.toBe(keyB);
  });

  it("accepts only current actor, stage, token, generation and live well-formed claim", () => {
    expect(validateFoundationTriageSealClaim({ claim: claim(tokenB, 2), workspaceKey, actorUserId,
      stageId, preflightApprovalId, sealToken: tokenB, now })?.fenceGeneration).toBe(2);
    expect(validateFoundationTriageSealClaim({ claim: claim(tokenA, 1), workspaceKey, actorUserId,
      stageId, preflightApprovalId, sealToken: tokenB, now })).toBeNull();
    expect(validateFoundationTriageSealClaim({ claim: claim(tokenB, 2), workspaceKey,
      actorUserId: "99999999-9999-4999-8999-999999999999", stageId, preflightApprovalId, sealToken: tokenB, now })).toBeNull();
    expect(validateFoundationTriageSealClaim({ claim: { ...claim(tokenB, 2), sealLeaseUntil: "2026-10-04T11:59:59Z" },
      workspaceKey, actorUserId, stageId, preflightApprovalId, sealToken: tokenB, now })).toBeNull();
    expect(validateFoundationTriageSealClaim({ claim: { ...claim(tokenB, 2), relativePath: "../secret.pdf" },
      workspaceKey, actorUserId, stageId, preflightApprovalId, sealToken: tokenB, now })).toBeNull();
  });
});
