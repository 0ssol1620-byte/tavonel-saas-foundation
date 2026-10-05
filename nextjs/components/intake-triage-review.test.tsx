import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import IntakeTriageReview, { TriageCostStatus, TriageReviewList } from "./intake-triage-review";

describe("intake triage review surface", () => {
  it("separates published customer page charges from unpriced operator cost", () => {
    const html = renderToStaticMarkup(createElement(IntakeTriageReview, {
      files: [],
      getToken: async () => "token",
      onLegacyFallback: vi.fn(),
      onProcessingApproval: vi.fn(),
      initialEstimate: { minimumUsd: 1.25, maximumUsd: 3.5 },
      selectionRevision: "selection-1",
    }));
    expect(html).toContain("The published policy permits zero additional page charges for a recompile only when unchanged source versions are verified as already read.");
    expect(html).toContain("Operator infrastructure cost");
    expect(html).not.toContain("No full-processing approval is available while costs");
    expect(html).toContain("Review sources before processing");
    expect(html).not.toContain("Approve maximum & upload");
    expect(html).not.toContain("Approve full processing");
  });


  it("shows recompile quote and approval unavailable when trusted prior-read proof is missing", () => {
    const html = renderToStaticMarkup(createElement(TriageCostStatus, {
      estimate: {
        currency: "USD",
        initial: { minimum: 1.25, maximum: 3.5 },
        incremental: { minimum: 0, maximum: 0 },
        customerChargeCoverage: {
          policy: "published_page_admission_once", scope: "entire_affected_source_version_set",
          pricingFingerprint: `sha256:${"a".repeat(64)}`,
          sourceVersions: [{ fileKey: "source-a", revision: "revision-a", contentSha256: `sha256:${"b".repeat(64)}`, mode: "unchanged_already_read_recompile" }],
        },
        operatorCost: { status: "not_priced", unavailableProviders: ["cdr_infrastructure"] },
        basis: "existing quote", assumptions: [],
      },
      approvalBlockers: ["READ_PROOF_REQUIRED"],
    }));
    expect(html).toContain("Recompile quote and approval unavailable.");
    expect(html).toContain("no trusted persisted proof that these unchanged source versions were already read and metered");
    expect(html).toContain("No incremental charge is quoted for this request.");
    expect(html).not.toContain("$0.00");
  });
  it("keeps exact duplicate paths separate and displays unresolved safety observations", () => {
    const html = renderToStaticMarkup(createElement(TriageReviewList, {
      review: [
        { fileKey: "source-a", relativePath: "folder/a.pdf", choice: null, disposition: "needs_review", exactDuplicateOf: "source-b", unknowns: { signature: "valid", encryption: "unknown", corruption: "unknown", archiveExpansion: "unknown" } },
        { fileKey: "source-b", relativePath: "folder/copy.pdf", choice: null, disposition: "needs_review", exactDuplicateOf: null, unknowns: { signature: "valid", encryption: "unknown", corruption: "unknown", archiveExpansion: "unknown" } },
      ],
      choices: {},
      onChoice: vi.fn(),
    }));
    expect(html).toContain("folder/a.pdf");
    expect(html).toContain("folder/copy.pdf");
    expect(html.match(/Exact byte duplicate candidate/g)).toHaveLength(1);
    expect(html.match(/encryption: unknown/g)).toHaveLength(2);
    expect(html.match(/corruption: unknown/g)).toHaveLength(2);
  });
});
