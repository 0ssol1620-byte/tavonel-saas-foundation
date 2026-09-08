import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { activationPolicy } from "./activation-policy";
import type { CollectionOcrInput } from "./collection-compiler";
import { buildProductCoreV2Request } from "./core-runtime-v2";
import { readCapabilities } from "./capabilities";

/**
 * The live path, asserted from the outside.
 *
 * `shared/customerDataGate.ts` makes it *possible* to accept customer data. This file exists to
 * prove that nothing in the deployed request path takes that option. There is exactly one place
 * where a real compile request is built -- `buildProductCoreV2Request` -- and it writes the privacy
 * policy as a literal that no caller can influence. That literal is itself a fail-closed gate, and
 * this test is what stops a later refactor from "wiring it up to the caller" without anyone
 * noticing that the caller is a browser-facing route.
 */

const here = dirname(fileURLToPath(import.meta.url));
const coreRuntimeSource = readFileSync(join(here, "core-runtime-v2.ts"), "utf8");

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

describe("customer data is not on the live compile path", () => {
  it("builds every request as synthetic-only", () => {
    const request = buildProductCoreV2Request("pilot-abc", inputs(), new Date("2026-09-06T00:00:00.000Z"));
    expect(request.route.privacyPolicy).toBe("foundation_synthetic_only");
  });

  it("never names the customer-data policy anywhere in the request builder", () => {
    expect(coreRuntimeSource).toContain('privacyPolicy: "foundation_synthetic_only"');
    expect(coreRuntimeSource).not.toContain("approved_customer_data");
    // The request type admits one value, so a caller-supplied policy would not compile.
    expect(coreRuntimeSource).toContain('privacyPolicy: "foundation_synthetic_only";');
  });

  it("keeps the deployment's customer-data capability closed", () => {
    expect(activationPolicy.customerData.enabled).toBe(false);
    expect(activationPolicy.customerData.reason).toMatch(/security suite/i);
    expect(activationPolicy.customerData.reason).toMatch(/approval receipt/i);
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
