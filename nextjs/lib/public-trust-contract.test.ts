import { describe, expect, it } from "vitest";
import {
  PUBLIC_TRUST_DISCLOSURE_BY_ID,
  PUBLIC_TRUST_DISCLOSURE_IDS,
  PUBLIC_TRUST_DISCLOSURES,
  getPublicTrustDisclosure,
  selectPublicTrustDisclosures,
} from "./public-trust-contract";

describe("public trust contract", () => {
  it("has one stable unique id for every disclosure", () => {
    expect(PUBLIC_TRUST_DISCLOSURES.map((row) => row.id)).toEqual(PUBLIC_TRUST_DISCLOSURE_IDS);
    expect(new Set(PUBLIC_TRUST_DISCLOSURE_IDS).size).toBe(PUBLIC_TRUST_DISCLOSURE_IDS.length);
    expect(Object.keys(PUBLIC_TRUST_DISCLOSURE_BY_ID).sort()).toEqual(
      [...PUBLIC_TRUST_DISCLOSURE_IDS].sort(),
    );
  });

  it("selects canonical rows in the consumer's requested order", () => {
    const selected = selectPublicTrustDisclosures(["dpa", "privacy", "qualified_review"]);
    expect(selected.map((row) => row.id)).toEqual(["dpa", "privacy", "qualified_review"]);
    expect(selected[0]).toBe(getPublicTrustDisclosure("dpa"));
  });

  it("keeps required legal and processor records public", () => {
    expect(getPublicTrustDisclosure("dpa").line).toContain("draft, not a signed agreement");
    expect(getPublicTrustDisclosure("privacy").line).toContain("storage and transfer locations");
    expect(getPublicTrustDisclosure("subprocessors").line).toContain("third parties permitted to process customer data");
  });

  it("routes deployment-specific evidence through qualified review", () => {
    const review = getPublicTrustDisclosure("qualified_review");
    expect(review.status).toBe("available_on_request");
    expect(review.href).toBe("/contact");
    for (const material of ["architecture", "control evidence", "assurance scope", "questionnaire responses"])
      expect(review.line).toContain(material);
  });

  it("does not publish topology, staffing, roadmap, or a deficiency inventory", () => {
    const publicCopy = PUBLIC_TRUST_DISCLOSURES.map((row) => `${row.subject} ${row.line}`).join("\n").toLowerCase();
    for (const internal of [
      "runpod", "cloud run", "vercel", "supabase", "clamav", "pdfium", "one person",
      "on-call rotation", "first paying customer", "roadmap", "soc 2", "iso 27001",
      "penetration test", "saml", "scim", "decision log", "fd-12",
    ]) {
      expect(publicCopy).not.toContain(internal);
    }
    expect(publicCopy).not.toMatch(/\b(?:rpo|rto)\b/);
  });
});
