import { describe, expect, it } from "vitest";
import { readLegalOperator } from "./legal-operator";

const COMPLETE = {
  TAVONEL_LEGAL_BUSINESS_NAME: "TAVONEL",
  TAVONEL_LEGAL_REPRESENTATIVE: "Representative",
  TAVONEL_LEGAL_BUSINESS_NUMBER: "123-45-67890",
  TAVONEL_LEGAL_ADDRESS: "Business address",
  TAVONEL_LEGAL_PHONE: "+82 2-1234-5678",
  TAVONEL_LEGAL_EMAIL: "SUPPORT@TAVONEL.COM",
};

describe("public legal operator", () => {
  it("fails closed when any required disclosure is missing", () => {
    expect(readLegalOperator({ ...COMPLETE, TAVONEL_LEGAL_PHONE: "" })).toBeNull();
  });

  it("rejects malformed public identifiers", () => {
    expect(readLegalOperator({ ...COMPLETE, TAVONEL_LEGAL_BUSINESS_NUMBER: "123" })).toBeNull();
    expect(readLegalOperator({ ...COMPLETE, TAVONEL_LEGAL_EMAIL: "invalid" })).toBeNull();
  });

  it("returns a normalized complete disclosure", () => {
    expect(readLegalOperator(COMPLETE)).toEqual({
      businessName: "TAVONEL",
      representative: "Representative",
      businessNumber: "123-45-67890",
      address: "Business address",
      phone: "+82 2-1234-5678",
      email: "support@tavonel.com",
    });
  });
});
