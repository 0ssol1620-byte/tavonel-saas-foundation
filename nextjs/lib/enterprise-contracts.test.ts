import { describe, expect, it } from "vitest";
import { enterpriseRoleAllows, identityProviderRuntimeReady, parseEnterpriseIdentityInput, parseEnterprisePolicyInput } from "./enterprise-contracts";

describe("enterprise RBAC", () => {
  it("keeps security and billing duties separate", () => {
    expect(enterpriseRoleAllows("security_admin", null, "identity:write")).toBe(true);
    expect(enterpriseRoleAllows("security_admin", null, "billing:read")).toBe(false);
    expect(enterpriseRoleAllows("billing_admin", null, "billing:read")).toBe(true);
    expect(enterpriseRoleAllows("billing_admin", null, "audit:export")).toBe(false);
  });

  it("allows workspace operators to operate but not write policy", () => {
    expect(enterpriseRoleAllows("member", "operator", "workspace:operate")).toBe(true);
    expect(enterpriseRoleAllows("member", "operator", "workspace:write")).toBe(false);
    expect(enterpriseRoleAllows("viewer", "viewer", "workspace:read")).toBe(true);
  });
});

describe("enterprise identity contract", () => {
  it("fails closed when SAML metadata or its secret reference is missing", () => {
    expect(parseEnterpriseIdentityInput({ protocol: "saml", provider: "okta", desiredStatus: "configured", configuration: { entityId: "urn:tavonel:test", ssoUrl: "https://idp.example.com/sso", certificateFingerprint: "AA:BB:CC:DD:EE:FF:AA:BB:CC:DD:EE:FF:AA:BB:CC:DD" }, secretReference: null })).toBeNull();
    expect(identityProviderRuntimeReady("saml", {})).toBe(false);
    expect(identityProviderRuntimeReady("saml", { ENTERPRISE_SAML_PROVIDER_ENABLED: "true" })).toBe(true);
  });

  it("accepts metadata and an external secret reference without accepting secret fields", () => {
    expect(parseEnterpriseIdentityInput({ protocol: "scim", provider: "entra_id", desiredStatus: "configured", configuration: { baseUrl: "https://graph.example.com/scim", externalIdAttribute: "externalId" }, secretReference: "azure-kv://tavonel/scim-token" })).toMatchObject({ protocol: "scim", desiredStatus: "configured" });
    expect(parseEnterpriseIdentityInput({ protocol: "scim", provider: "entra_id", desiredStatus: "configured", configuration: { baseUrl: "https://graph.example.com/scim", token: "plaintext", externalIdAttribute: "externalId" }, secretReference: "azure-kv://tavonel/scim-token" })).toBeNull();
  });
});

describe("enterprise policy contract", () => {
  it("accepts bounded governance policy and rejects no-region policies", () => {
    const policy = { retentionDays: 365, deletedObjectGraceDays: 30, auditRetentionDays: 2555, exportFormat: "jsonl", exportSigningRequired: true, legalHoldEnabled: false, allowedRegions: ["apac"], dedicatedDeploymentRequired: false, rtoMinutes: 240, rpoMinutes: 1440 };
    expect(parseEnterprisePolicyInput(policy)).toEqual(policy);
    expect(parseEnterprisePolicyInput({ ...policy, allowedRegions: [] })).toBeNull();
    expect(parseEnterprisePolicyInput({ ...policy, retentionDays: 0 })).toBeNull();
  });
});
