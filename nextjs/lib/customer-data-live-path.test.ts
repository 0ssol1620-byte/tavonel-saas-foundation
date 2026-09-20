import { describe, expect, it } from "vitest";
import { evaluateCustomerDataGate } from "../../shared/customerDataGate";
import { customerDataPreconditions } from "../../shared/uskcEnums";
import { activationPolicy } from "./activation-policy";
import type { CollectionOcrInput } from "./collection-compiler";
import { buildProductCoreV2Request } from "./core-runtime-v2";
import { readCapabilities } from "./capabilities";

function inputs(): CollectionOcrInput[] {
  const versionKey = "a".repeat(64);
  const sanitizedKey = `immutable/pilot/pilot/doc-1/${versionKey}/sanitized.pdf`;
  return [
    {
      documentId: "doc-1",
      versionKey,
      sanitizedKey,
      ocrJsonKey: sanitizedKey.replace("sanitized.pdf", "ocr.json"),
      pageCount: 1,
      text: "Document 1 evidence is complete.",
      inputSha256: `sha256:${versionKey}`,
      sourceImmutableKey: sanitizedKey,
    },
  ];
}

function allowedGate(workspaceId: string) {
  return evaluateCustomerDataGate({
    tenantId: workspaceId,
    workspaceId,
    now: "2026-09-20T00:00:00.000Z",
    evidence: customerDataPreconditions.map((precondition) => ({
      precondition,
      satisfied: true,
      evidence: `receipt:${precondition}`,
      checkedAt: "2026-09-20T00:00:00.000Z",
    })),
  });
}

describe("customer data on the live compile path", () => {
  it("keeps the pure request builder synthetic-only when no verified decision is supplied", () => {
    const request = buildProductCoreV2Request("pilot-abc", inputs(), new Date("2026-09-06T00:00:00.000Z"));
    expect(request.route.privacyPolicy).toBe("foundation_synthetic_only");
  });

  it("uses the customer-data policy only for an exact allowed decision", () => {
    const exact = allowedGate("pilot-abc");
    const admitted = buildProductCoreV2Request(
      "pilot-abc",
      inputs(),
      new Date("2026-09-20T00:00:00.000Z"),
      "request-1",
      null,
      exact,
    );
    expect(admitted.route.privacyPolicy).toBe("approved_customer_data");

    const wrongWorkspace = buildProductCoreV2Request(
      "pilot-other",
      inputs(),
      new Date("2026-09-20T00:00:00.000Z"),
      "request-2",
      null,
      exact,
    );
    expect(wrongWorkspace.route.privacyPolicy).toBe("foundation_synthetic_only");
  });

  it("keeps the public capability closed until a production receipt exists", () => {
    expect(activationPolicy.customerData.enabled).toBe(false);
    const { reason } = activationPolicy.customerData;
    expect(reason).toMatch(/remains closed/i);
    expect(reason).toMatch(/production evidence/i);
  });

  /*
    G3-003 keeps storage admission and compile permission as separate facts. Activation does not
    weaken the quarantine statement or turn it into a generic "upload is open" claim.
  */
  it("keeps the intake description precise while compilation is closed", () => {
    expect(activationPolicy.customerData.enabled).toBe(false);
    const { reason } = activationPolicy.customerIntake;
    expect(reason).toMatch(/tenant-scoped quarantine/i);
  });

  it("says so on the public capability grid", () => {
    const grid = readCapabilities({ activationPolicy: { ...activationPolicy } }, false);
    expect(grid.find((capability) => capability.name === "Customer-data compilation")).toEqual({
      name: "Customer-data compilation",
      state: "Closed",
      tone: "closed",
      note: activationPolicy.customerData.reason,
    });
  });
});
