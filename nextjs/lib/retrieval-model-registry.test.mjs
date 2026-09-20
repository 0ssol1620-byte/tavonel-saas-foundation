import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { selectRegisteredRetrievalModel } from "./retrieval-model-registry.ts";

const NOW = new Date("2026-09-20T04:00:00.000Z");
const REQUEST = {
  registryId: "retrieval-bge-m3",
  role: "embedder",
  provider: "huggingface",
  model: "BAAI/bge-m3",
  revision: "142964af7e05de16511657561de8e8750fc153a0",
};

function entry(overrides = {}) {
  return {
    ...REQUEST,
    eligible: true,
    approvalStatus: "approved",
    approvalId: "approval-2026-09-20-001",
    approvedAt: "2026-09-20T02:00:00.000Z",
    verifiedAt: "2026-09-20T03:00:00.000Z",
    validUntil: "2026-09-21T03:00:00.000Z",
    license: { status: "approved", approvalId: "license-approval-001" },
    providerDataPolicy: { status: "approved", approvalId: "policy-approval-001" },
    capabilityReceiptIds: ["capability-receipt-001"],
    priceSnapshot: {
      snapshotId: "price-2026-09-20",
      currency: "USD",
      unit: "million_tokens",
      unitPrice: 0.42,
      effectiveAt: "2026-09-20T00:00:00.000Z",
      validUntil: "2026-09-21T00:00:00.000Z",
    },
    lifecycle: { status: "active", permittedUses: ["fixed_retrieval"] },
    ...overrides,
  };
}

test("ineligible, unapproved, stale and identity-mismatched entries are never selected", () => {
  const cases = [
    [{ eligible: false }, "REGISTRY_ENTRY_INELIGIBLE"],
    [{ approvalStatus: "pending" }, "REGISTRY_ENTRY_NOT_APPROVED"],
    [{ approvalStatus: "rejected" }, "REGISTRY_ENTRY_NOT_APPROVED"],
    [{ approvalStatus: "revoked" }, "REGISTRY_ENTRY_NOT_APPROVED"],
    [{ validUntil: "2026-09-20T04:00:00.000Z" }, "REGISTRY_ENTRY_STALE"],
    [{ verifiedAt: "2026-09-20T05:00:00.000Z" }, "REGISTRY_ENTRY_STALE"],
    [{ revision: "unapproved-revision" }, "REGISTRY_ENTRY_IDENTITY_MISMATCH"],
  ];
  for (const [overrides, reason] of cases) {
    assert.deepEqual(
      selectRegisteredRetrievalModel([entry(overrides)], REQUEST, NOW).selected,
      false,
      reason,
    );
    assert.equal(selectRegisteredRetrievalModel([entry(overrides)], REQUEST, NOW).reason, reason);
  }
});

test("every fixed-retrieval eligibility proof fails closed independently", () => {
  const cases = [
    [{ license: { status: "pending", approvalId: "license-approval-001" } }, "REGISTRY_ENTRY_LICENSE_NOT_APPROVED"],
    [{ providerDataPolicy: { status: "revoked", approvalId: "policy-approval-001" } }, "REGISTRY_ENTRY_PROVIDER_POLICY_NOT_APPROVED"],
    [{ capabilityReceiptIds: [] }, "REGISTRY_ENTRY_CAPABILITY_RECEIPTS_MISSING"],
    [{ capabilityReceiptIds: ["same", "same"] }, "REGISTRY_ENTRY_CAPABILITY_RECEIPTS_MISSING"],
    [{ priceSnapshot: { ...entry().priceSnapshot, validUntil: NOW.toISOString() } }, "REGISTRY_ENTRY_PRICE_SNAPSHOT_INVALID"],
    [{ priceSnapshot: { ...entry().priceSnapshot, effectiveAt: "2026-09-20T05:00:00.000Z" } }, "REGISTRY_ENTRY_PRICE_SNAPSHOT_INVALID"],
    [{ lifecycle: { status: "suspended", permittedUses: ["fixed_retrieval"] } }, "REGISTRY_ENTRY_LIFECYCLE_NOT_PERMITTED"],
    [{ lifecycle: { status: "active", permittedUses: ["adaptive_routing"] } }, "REGISTRY_ENTRY_LIFECYCLE_NOT_PERMITTED"],
  ];
  for (const [overrides, reason] of cases) {
    assert.equal(selectRegisteredRetrievalModel([entry(overrides)], REQUEST, NOW).reason, reason);
  }
});

test("missing or malformed eligibility proof is malformed and never selected", () => {
  for (const field of ["license", "providerDataPolicy", "capabilityReceiptIds", "priceSnapshot", "lifecycle"]) {
    const candidate = entry();
    delete candidate[field];
    const result = selectRegisteredRetrievalModel([candidate], REQUEST, NOW);
    assert.equal(result.selected, false);
    assert.equal(result.reason, "REGISTRY_MALFORMED");
  }
});

test("only one exact, eligible, approved and fresh entry is selected", () => {
  assert.deepEqual(selectRegisteredRetrievalModel([entry()], REQUEST, NOW), {
    registryId: REQUEST.registryId,
    role: REQUEST.role,
    selected: true,
    reason: "SELECTED",
    approvalId: "approval-2026-09-20-001",
    verifiedAt: "2026-09-20T03:00:00.000Z",
    validUntil: "2026-09-21T03:00:00.000Z",
  });
});

test("absent, malformed and duplicate registries fail closed without provider I/O", () => {
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("provider call forbidden"); };
  assert.equal(selectRegisteredRetrievalModel(null, REQUEST, NOW).reason, "REGISTRY_NOT_CONFIGURED");
  assert.equal(selectRegisteredRetrievalModel({ entries: [] }, REQUEST, NOW).reason, "REGISTRY_MALFORMED");
  assert.equal(selectRegisteredRetrievalModel([entry(), entry()], REQUEST, NOW).reason, "REGISTRY_ENTRY_DUPLICATE");
  assert.equal(providerCalls, 0);
  delete globalThis.fetch;
});

test("every production caller uses the selector and governed adapters record its decision", () => {
  const lib = dirname(fileURLToPath(import.meta.url));
  const root = resolve(lib, "..");
  const runtime = readFileSync(resolve(lib, "retrieval-runtime-config.ts"), "utf8");
  const ask = readFileSync(resolve(root, "app/api/collections/[id]/ask/route.ts"), "utf8");
  const search = readFileSync(resolve(root, "app/api/collections/[id]/search/route.ts"), "utf8");
  const index = readFileSync(resolve(lib, "retrieval-index-status.ts"), "utf8");

  assert.match(runtime, /env && embedding\.selected \? createProductionEmbedderAdapter\(env, workspaceKey\) : null/);
  assert.match(runtime, /env && reranker\.selected \? createProductionRerankerAdapter\(env, workspaceKey\) : null/);
  assert.match(runtime, /createGovernedModelProviderFetcher/);
  for (const source of [ask, search, index]) {
    assert.match(source, /selectProductionRetrievalRuntime\(/);
    assert.doesNotMatch(source, /runtimeEnv\s*\?\s*createProduction/);
  }
  assert.match(ask, /modelRoute: runtime\.decision/);
  assert.match(search, /modelRoute: runtime\.decision/);
});
