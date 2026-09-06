import { describe, expect, it } from "vitest";
import {
  CUSTOMER_DATA_GATE_SCHEMA,
  customerDataEvidenceReceiptSha256,
  evaluateCustomerDataGate,
  gateAdmitsCustomerData,
  type CustomerDataGateDecision,
  type PreconditionEvidence,
} from "../../shared/customerDataGate";
import { CUSTOMER_DATA_PRECONDITIONS, PRIVACY_POLICIES } from "../../shared/uskcEnums";
import {
  COMPILE_JOB_SCHEMA,
  validateCompileJobEnvelope,
  type CompileJobEnvelope,
} from "../../shared/productCoreCompileEnvelope";

const NOW = "2026-09-06T00:00:00.000Z";

/**
 * A complete, satisfied evidence set. It is a fixture and only a fixture: several of these
 * preconditions are MISSING in this deployment (see docs/CUSTOMER_DATA_GATE_2026-09-06.md), so no
 * production code can assemble this list. It exists so the allowed branch is exercised at all --
 * a gate whose true branch is never tested is a gate nobody has read.
 */
function satisfiedEvidence(): PreconditionEvidence[] {
  return CUSTOMER_DATA_PRECONDITIONS.map((precondition) => ({
    precondition,
    satisfied: true,
    evidence: `fixture://${precondition}`,
    checkedAt: NOW,
  }));
}

function envelope(): CompileJobEnvelope {
  return {
    schemaVersion: COMPILE_JOB_SCHEMA,
    jobId: "job_01",
    idempotencyKey: "idem_01",
    tenantId: "tenant_01",
    workspaceId: "workspace_01",
    source: {
      sourceId: "src_01",
      sourceVersionId: "dv_01",
      immutableObjectKey: "immutable/tenant_01/workspace_01/dv_01/input.pdf",
      contentSha256: `sha256:${"a".repeat(64)}`,
      mimeType: "application/pdf",
      byteLength: 806,
      quarantineProofId: "proof_01",
      sanitized: true,
    },
    route: {
      operationClass: "initial_compile",
      qualityRequirement: "high_assurance",
      maxCostCredits: 4,
      maxLatencyMs: 30_000,
      privacyPolicy: "approved_customer_data",
    },
    requestedAtMs: 1_757_000_000_000,
  };
}

function allowedGate(overrides: Partial<Extract<CustomerDataGateDecision, { allowed: true }>> = {}) {
  const decision = evaluateCustomerDataGate({
    tenantId: "tenant_01",
    workspaceId: "workspace_01",
    evidence: satisfiedEvidence(),
    now: NOW,
  });
  expect(decision.allowed).toBe(true);
  return { ...(decision as Extract<CustomerDataGateDecision, { allowed: true }>), ...overrides };
}

describe("customer-data gate vocabulary", () => {
  it("carries the seventeen frozen preconditions in the frozen order", () => {
    expect([...CUSTOMER_DATA_PRECONDITIONS]).toEqual([
      "tenant_isolation_suite_passed",
      "encryption_at_rest_verified",
      "encryption_in_transit_verified",
      "connector_credentials_in_secret_manager",
      "no_secrets_in_receipts_or_logs_verified",
      "malware_scan_and_quarantine_active",
      "archive_bomb_limits_enforced",
      "compile_receipts_signed_and_audited",
      "deletion_tombstone_propagation_verified",
      "retention_controls_configured",
      "data_export_and_delete_available",
      "audit_log_active",
      "least_privilege_connector_scopes_verified",
      "per_provider_isolation_verified",
      "dpa_and_privacy_notice_published",
      "per_source_acl_preserved",
      "founder_approval_receipt_recorded",
    ]);
    expect([...PRIVACY_POLICIES]).toEqual(["foundation_synthetic_only", "approved_customer_data"]);
  });
});

describe("customer-data gate evaluation", () => {
  it("refuses the empty evidence set by naming all seventeen", () => {
    const decision = evaluateCustomerDataGate({
      tenantId: "tenant_01",
      workspaceId: "workspace_01",
      evidence: [],
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.missing).toEqual([...CUSTOMER_DATA_PRECONDITIONS]);
  });

  it("refuses sixteen of seventeen and names the one that is missing", () => {
    const evidence = satisfiedEvidence().filter(
      (entry) => entry.precondition !== "per_source_acl_preserved",
    );
    const decision = evaluateCustomerDataGate({
      tenantId: "tenant_01",
      workspaceId: "workspace_01",
      evidence,
      now: NOW,
    });
    expect(decision).toEqual({
      allowed: false,
      schemaVersion: CUSTOMER_DATA_GATE_SCHEMA,
      tenantId: "tenant_01",
      workspaceId: "workspace_01",
      missing: ["per_source_acl_preserved"],
      evaluatedAt: NOW,
    });
  });

  it("refuses a precondition marked satisfied with no evidence behind it", () => {
    const evidence = satisfiedEvidence().map((entry) =>
      entry.precondition === "audit_log_active" ? { ...entry, evidence: "   " } : entry,
    );
    const decision = evaluateCustomerDataGate({
      tenantId: "tenant_01",
      workspaceId: "workspace_01",
      evidence,
      now: NOW,
    });
    expect(decision.allowed === false && decision.missing).toEqual(["audit_log_active"]);
  });

  it("refuses two disagreeing rows for one precondition rather than taking the true one", () => {
    const evidence: PreconditionEvidence[] = [
      ...satisfiedEvidence(),
      {
        precondition: "tenant_isolation_suite_passed",
        satisfied: false,
        evidence: "server/foundation/rlsMatrixContract.test.ts",
        checkedAt: NOW,
      },
    ];
    const decision = evaluateCustomerDataGate({
      tenantId: "tenant_01",
      workspaceId: "workspace_01",
      evidence,
      now: NOW,
    });
    expect(decision.allowed === false && decision.missing).toEqual(["tenant_isolation_suite_passed"]);
  });

  it("refuses evidence stamped with a time that does not parse", () => {
    const evidence = satisfiedEvidence().map((entry) =>
      entry.precondition === "retention_controls_configured"
        ? { ...entry, checkedAt: "whenever" }
        : entry,
    );
    const decision = evaluateCustomerDataGate({
      tenantId: "tenant_01",
      workspaceId: "workspace_01",
      evidence,
      now: NOW,
    });
    expect(decision.allowed === false && decision.missing).toEqual(["retention_controls_configured"]);
  });

  /**
   * `Date.parse` accepts all of these. A gate stamped "2026" or "0" is not auditable to a moment,
   * and the earlier check -- non-blank plus `Date.parse` -- let every one of them through.
   */
  it.each(["2026", "0", "Sat Sep 6 2026", "2026-09-06", "now"])(
    "refuses evidence stamped %j, which Date.parse tolerates but is not an instant",
    (checkedAt) => {
      const evidence = satisfiedEvidence().map((entry) =>
        entry.precondition === "audit_log_active" ? { ...entry, checkedAt } : entry,
      );
      const decision = evaluateCustomerDataGate({
        tenantId: "tenant_01",
        workspaceId: "workspace_01",
        evidence,
        now: NOW,
      });
      expect(decision.allowed === false && decision.missing).toEqual(["audit_log_active"]);
    },
  );

  it("refuses everything when `now` is not an instant, and never stamps a decision with it", () => {
    const decision = evaluateCustomerDataGate({
      tenantId: "tenant_01",
      workspaceId: "workspace_01",
      evidence: satisfiedEvidence().map((entry) => ({ ...entry, checkedAt: "0" })),
      now: "0",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.missing).toEqual([...CUSTOMER_DATA_PRECONDITIONS]);
    expect(decision.evaluatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("refuses an unidentified subject even with complete evidence", () => {
    const decision = evaluateCustomerDataGate({
      tenantId: "  ",
      workspaceId: "workspace_01",
      evidence: satisfiedEvidence(),
      now: NOW,
    });
    expect(decision.allowed === false && decision.missing).toEqual([...CUSTOMER_DATA_PRECONDITIONS]);
  });

  it("allows only a complete, evidenced set, and binds a receipt digest to it", () => {
    const decision = evaluateCustomerDataGate({
      tenantId: "tenant_01",
      workspaceId: "workspace_01",
      evidence: satisfiedEvidence(),
      now: NOW,
    });
    expect(decision).toEqual({
      allowed: true,
      schemaVersion: CUSTOMER_DATA_GATE_SCHEMA,
      tenantId: "tenant_01",
      workspaceId: "workspace_01",
      receiptSha256: customerDataEvidenceReceiptSha256(satisfiedEvidence()),
      evaluatedAt: NOW,
    });
  });

  it("digests the evidence, not the order it was assembled in", () => {
    const forward = satisfiedEvidence();
    const reversed = [...forward].reverse();
    expect(customerDataEvidenceReceiptSha256(reversed)).toBe(
      customerDataEvidenceReceiptSha256(forward),
    );
    const altered = forward.map((entry) =>
      entry.precondition === "audit_log_active" ? { ...entry, evidence: "somewhere else" } : entry,
    );
    expect(customerDataEvidenceReceiptSha256(altered)).not.toBe(
      customerDataEvidenceReceiptSha256(forward),
    );
  });
});

describe("compile envelope, customer-data branch", () => {
  it("refuses approved_customer_data with no gate, exactly as before this lane", () => {
    expect(validateCompileJobEnvelope(envelope())).toEqual({
      accepted: false,
      code: "PRIVACY_POLICY_NOT_ALLOWED",
    });
  });

  it("refuses a refused gate", () => {
    const refused = evaluateCustomerDataGate({
      tenantId: "tenant_01",
      workspaceId: "workspace_01",
      evidence: [],
      now: NOW,
    });
    expect(validateCompileJobEnvelope(envelope(), refused)).toEqual({
      accepted: false,
      code: "PRIVACY_POLICY_NOT_ALLOWED",
    });
  });

  it("refuses an allowed gate issued for another tenant", () => {
    const other = evaluateCustomerDataGate({
      tenantId: "tenant_02",
      workspaceId: "workspace_01",
      evidence: satisfiedEvidence(),
      now: NOW,
    });
    expect(other.allowed).toBe(true);
    expect(validateCompileJobEnvelope(envelope(), other)).toEqual({
      accepted: false,
      code: "PRIVACY_POLICY_NOT_ALLOWED",
    });
  });

  it("refuses an allowed gate issued for another workspace of the same tenant", () => {
    const other = evaluateCustomerDataGate({
      tenantId: "tenant_01",
      workspaceId: "workspace_02",
      evidence: satisfiedEvidence(),
      now: NOW,
    });
    expect(validateCompileJobEnvelope(envelope(), other)).toEqual({
      accepted: false,
      code: "PRIVACY_POLICY_NOT_ALLOWED",
    });
  });

  it("refuses a hand-built decision that claims allowed without a receipt digest", () => {
    const forged = allowedGate({ receiptSha256: "trust me" });
    expect(gateAdmitsCustomerData(forged, "tenant_01", "workspace_01")).toBe(false);
    expect(validateCompileJobEnvelope(envelope(), forged)).toEqual({
      accepted: false,
      code: "PRIVACY_POLICY_NOT_ALLOWED",
    });
  });

  it("refuses a decision carrying a schema version this code does not implement", () => {
    const forged = allowedGate({
      schemaVersion: "tavonel.customer_data_gate.v2" as typeof CUSTOMER_DATA_GATE_SCHEMA,
    });
    expect(validateCompileJobEnvelope(envelope(), forged)).toEqual({
      accepted: false,
      code: "PRIVACY_POLICY_NOT_ALLOWED",
    });
  });

  it("accepts approved_customer_data only behind a matching allowed gate", () => {
    const result = validateCompileJobEnvelope(envelope(), allowedGate());
    expect(result.accepted).toBe(true);
  });

  it("still applies every other envelope rule behind an allowed gate", () => {
    const input = envelope();
    input.source.immutableObjectKey = "immutable/tenant_01/workspace_01/../other.pdf";
    expect(validateCompileJobEnvelope(input, allowedGate())).toEqual({
      accepted: false,
      code: "OBJECT_KEY_INVALID",
    });
  });

  it("leaves the synthetic path untouched whether or not a gate is passed", () => {
    const input = envelope();
    input.route.privacyPolicy = "foundation_synthetic_only";
    expect(validateCompileJobEnvelope(input).accepted).toBe(true);
    expect(validateCompileJobEnvelope(input, allowedGate()).accepted).toBe(true);
  });

  /**
   * The check is an allowlist. Written as `!== "foundation_synthetic_only" && !gate` it admitted
   * every other string behind an allowed gate -- the envelope is the Product-to-Core wire contract,
   * so its input is a deserialized JSON body and the union does not close it at runtime.
   */
  it.each(["raw_customer_pii_no_redaction", "", "approved_customer_dataX", "APPROVED_CUSTOMER_DATA"])(
    "refuses privacyPolicy %j even behind an allowed gate",
    (privacyPolicy) => {
      const input = envelope();
      (input.route as { privacyPolicy: string }).privacyPolicy = privacyPolicy;
      expect(validateCompileJobEnvelope(input, allowedGate())).toEqual({
        accepted: false,
        code: "PRIVACY_POLICY_NOT_ALLOWED",
      });
      expect(validateCompileJobEnvelope(input)).toEqual({
        accepted: false,
        code: "PRIVACY_POLICY_NOT_ALLOWED",
      });
    },
  );

  it("accepts only the two values the frozen vocabulary spells", () => {
    for (const privacyPolicy of PRIVACY_POLICIES) {
      const input = envelope();
      input.route.privacyPolicy = privacyPolicy;
      expect(validateCompileJobEnvelope(input, allowedGate()).accepted).toBe(true);
    }
  });

  /**
   * The ceiling, pinned so that closing it later breaks a test rather than passing silently: the
   * digest is checked for SHAPE, never re-derived. The frozen decision type carries no evidence, so
   * re-derivation from the decision alone is not possible; the durable record is what closes it,
   * and `customerDataGateMigration.test.ts` re-derives from a stored row.
   */
  it("admits a sha256-SHAPED receipt digest that derives from nothing (known ceiling)", () => {
    const forged = allowedGate({ receiptSha256: `sha256:${"0".repeat(64)}` });
    expect(gateAdmitsCustomerData(forged, "tenant_01", "workspace_01")).toBe(true);
    expect(validateCompileJobEnvelope(envelope(), forged).accepted).toBe(true);
    // What is actually refused is a digest that is not sha256-shaped, and a wrong subject.
    expect(gateAdmitsCustomerData(forged, "tenant_02", "workspace_01")).toBe(false);
    expect(
      gateAdmitsCustomerData(allowedGate({ receiptSha256: "trust me" }), "tenant_01", "workspace_01"),
    ).toBe(false);
  });
});
