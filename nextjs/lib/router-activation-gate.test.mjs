import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADAPTIVE_ROUTER_ACTIVATION_SCHEMA,
  evaluateAdaptiveRouterActivation,
  hashAdaptiveRouterEvidenceContract,
} from "./router-activation-gate.ts";

const NOW = new Date("2026-09-20T05:00:00.000Z");
const ROUTER_REVISION = "router-revision-immutable-001";
const STAGES = ["arena", "oracle", "familyHoldout", "shadow", "canary"];

function sealedContract(overrides = {}) {
  const payload = {
    schemaVersion: ADAPTIVE_ROUTER_ACTIVATION_SCHEMA,
    activationId: "adaptive-router-activation-001",
    routerRevision: ROUTER_REVISION,
    approvalReceiptId: "founder-approval-receipt-001",
    approvedAt: "2026-09-20T04:00:00.000Z",
    evidence: Object.fromEntries(STAGES.map((stage, index) => [stage, {
      receiptId: `${stage}-receipt-001`,
      artifactSha256: String(index + 1).repeat(64),
      status: "passed",
      completedAt: `2026-09-20T0${index}:00:00.000Z`,
    }])),
    ...overrides,
  };
  return { ...payload, contractSha256: hashAdaptiveRouterEvidenceContract(payload) };
}

function evaluate(contract, expectedDigest = contract?.contractSha256) {
  return evaluateAdaptiveRouterActivation(contract, {
    routerRevision: ROUTER_REVISION,
    contractSha256: expectedDigest,
  }, NOW);
}

test("adaptive routing stays disabled without an explicit sealed contract", () => {
  assert.deepEqual(evaluateAdaptiveRouterActivation(null, {
    routerRevision: ROUTER_REVISION,
    contractSha256: "a".repeat(64),
  }, NOW), {
    enabled: false,
    reason: "ACTIVATION_CONTRACT_NOT_CONFIGURED",
    activationId: null,
    routerRevision: null,
    contractSha256: null,
  });
});

test("the exact complete immutable evidence contract is the only activation path", () => {
  const contract = sealedContract();
  assert.equal(evaluate(contract).enabled, true);
  assert.equal(evaluate(contract).reason, "ACTIVATED");

  const tampered = structuredClone(contract);
  tampered.evidence.arena.receiptId = "arena-receipt-tampered";
  assert.equal(evaluate(tampered).reason, "ACTIVATION_CONTRACT_DIGEST_MISMATCH");
  assert.equal(evaluate(contract, "f".repeat(64)).reason, "ACTIVATION_IDENTITY_MISMATCH");
  assert.equal(evaluate({ ...contract, routerRevision: "another-revision" }).reason, "ACTIVATION_IDENTITY_MISMATCH");
});

test("Arena, Oracle, family holdout, shadow and canary must each be present and passed", () => {
  for (const stage of STAGES) {
    const missingPayload = sealedContract();
    delete missingPayload.evidence[stage];
    assert.equal(evaluate(missingPayload).reason, "ACTIVATION_CONTRACT_MALFORMED", stage);

    const base = sealedContract();
    const evidence = structuredClone(base.evidence);
    evidence[stage].status = "failed";
    const failed = sealedContract({ evidence });
    assert.equal(evaluate(failed).reason, "ACTIVATION_EVIDENCE_FAILED", stage);
  }
});

test("duplicate evidence and impossible chronology fail closed", () => {
  const base = sealedContract();
  const duplicateEvidence = structuredClone(base.evidence);
  duplicateEvidence.oracle.receiptId = duplicateEvidence.arena.receiptId;
  const duplicate = sealedContract({ evidence: duplicateEvidence });
  assert.equal(evaluate(duplicate).reason, "ACTIVATION_EVIDENCE_INCOMPLETE");

  const futureEvidence = structuredClone(base.evidence);
  futureEvidence.canary.completedAt = "2026-09-20T04:30:00.000Z";
  const future = sealedContract({ evidence: futureEvidence });
  assert.equal(evaluate(future).reason, "ACTIVATION_EVIDENCE_TIME_INVALID");
});
