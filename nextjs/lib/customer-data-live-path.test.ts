import { describe, expect, it } from "vitest";
import { evaluateCustomerDataGate } from "../../shared/customerDataGate";
import { customerDataPreconditions } from "../../shared/uskcEnums";
import { activationPolicy } from "./activation-policy";
import { BILLING_OFFERS } from "./billing-catalog";
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

  /*
    COPY-TRUST 2026-09-22. The flag is what keeps the capability closed; the sentence beside it is
    the most-rendered string on this site.

    This case used to pin the reason to "remains closed" and "production evidence" -- our internal
    precondition vocabulary, printed on /pricing, /security, /status, /login, /integrations, the
    workspace and the landing's closing scene. Neither phrase is a receipt a reader can open, and
    an exact-workspace approval receipt is a fact about our release process rather than about what
    a buyer gets. What replaces them is the pair of facts the reader can act on: the public World
    is readable now, and compiling their own sources goes through us rather than a checkout.

    The gate itself is unweakened and is asserted where it lives -- `enabled` is false above, and
    every route guarding on it still refuses. The string may not quietly turn into an offer, so the
    two rules below are the ones that matter: it names the arranged path, and it never says a plan
    purchase opens the compile.
  */
  /*
    D-12, delegated decision 2026-11-09. The switch is on, so the sentence has to say what this
    deployment now does, in the reader's terms, and nothing it does not: the compile is the
    reader's own, only the self-serve plan is offered online (`saleChannel`), and none of our
    internal vocabulary rides along. The closed-gate phrasing is held out so it cannot survive the
    switch on the most-rendered sentence on the site.
  */
  it("states the open path in the reader's terms, and only the plan that sells itself as bought online", () => {
    expect(activationPolicy.customerData.enabled).toBe(true);
    const { reason } = activationPolicy.customerData;
    expect(reason).toMatch(/upload your own sources and compile them/i);
    expect(reason).toContain("The Developer plan can be bought online; Team and Enterprise are arranged with us.");
    expect(BILLING_OFFERS.observer_access.saleChannel).toBe("self_serve");
    expect(BILLING_OFFERS.studio_access.saleChannel).toBe("contact");
    expect(reason).not.toMatch(/rather than enabled by a plan purchase|set up with us/i);
    expect(reason).not.toMatch(/\b(gate|receipt|cohort|founder|qualif\w*)\b/i);
    expect(reason).not.toMatch(/\d/);
  });

  /*
    G3-003 keeps storage admission and compile permission as separate facts. Activation does not
    weaken the quarantine statement or turn it into a generic "upload is open" claim.
  */
  it("keeps the intake description precise now that compilation is open", () => {
    expect(activationPolicy.customerData.enabled).toBe(true);
    const { reason } = activationPolicy.customerIntake;
    expect(reason).toMatch(/tenant-scoped quarantine/i);
    expect(reason).not.toMatch(/arranged with us|opened by a checkout/i);
  });

  it("says so on the public capability grid", () => {
    const grid = readCapabilities({ activationPolicy: { ...activationPolicy } }, false);
    expect(grid.find((capability) => capability.name === "Customer-data compilation")).toEqual({
      name: "Customer-data compilation",
      state: "Open",
      tone: "open",
      note: activationPolicy.customerData.reason,
    });
    // Failure path: the grid still reads the flag, not the sentence.
    const closed = readCapabilities({ activationPolicy: { ...activationPolicy, customerData: { ...activationPolicy.customerData, enabled: false } } }, false);
    expect(closed.find((capability) => capability.name === "Customer-data compilation")?.state).toBe("Closed");
  });
});
