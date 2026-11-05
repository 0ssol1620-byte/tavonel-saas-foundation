import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompileJobPanel, type CompileJobView } from "../components/compile-job-panel";

const job: CompileJobView = {
  jobId: "job-review", state: "review_required", documentsTotal: 3, documentsReady: 3,
  blocked: [], blockedResolution: null, errorCode: null,
  collectionId: "collection-615b794cad15aa6375d2b79ac6690f74",
};
const render = (update: Partial<CompileJobView> = {}) => renderToStaticMarkup(createElement(CompileJobPanel, {
  job: { ...job, ...update }, onResolve() {}, onCancel() {},
}));

describe("compile job review handoff", () => {
  it("describes paused review and links to the actual collection rather than claiming background progress", () => {
    const html = render();
    expect(html).toContain("Processing has paused for your review");
    expect(html).toContain(`/workspace?collection=${job.collectionId}`);
    expect(html).not.toContain("This runs on our servers");
    expect(html).toContain("Cancel this compile");
  });
  it("keeps background reassurance for a running job", () => {
    const html = render({ state: "reading", collectionId: null });
    expect(html).toContain("This runs on our servers");
    expect(html).not.toContain("Review evidence package");
  });
  it.each([null, "../other", "collection-not-valid"])("does not offer a fabricated collection destination for %s", collectionId => {
    expect(render({ collectionId })).not.toContain("Review evidence package");
  });
  it.each(["ready", "failed", "cancelled"] as const)("does not offer work-in-progress actions for %s", state => {
    const html = render({ state });
    expect(html).not.toContain("This runs on our servers");
    expect(html).not.toContain("Cancel this compile");
    expect(html).not.toContain("Review evidence package");
  });
});

describe("a size refusal", () => {
  const sizeLimit = { bytes: 134_576_916, bound: 33_554_432,
    largestPackageFiles: [{ path: "rag/chunks.jsonl", sizeBytes: 90_000_000 }], counts: { contradictions: 719_400 } };

  it("says it is a size limit a retry will not change, and shows what was measured", () => {
    // REVIEW-PR192-R1 MAJOR-2: it read "Our servers could not complete this", and customers retried.
    const html = render({ state: "failed", errorCode: "JSON_TOO_LARGE", collectionId: null, sizeLimit });
    expect(html).not.toContain("Our servers");
    expect(html).toContain("Running the same set again gives the same result");
    expect(html).toContain("134,576,916 / 33,554,432 bytes");
    expect(html).toContain("<code>rag/chunks.jsonl</code> 90,000,000 bytes");
    expect(html).toContain("contradictions 719,400");
    expect(html).toContain("Reference JSON_TOO_LARGE");
  });

  it("speaks Korean when the browser does, and still says it without detail when none arrived", () => {
    const html = renderToStaticMarkup(createElement(CompileJobPanel, {
      job: { ...job, state: "failed", errorCode: "CORE_OUTPUT_TOO_LARGE", collectionId: null },
      languages: ["ko-KR"], onResolve() {}, onCancel() {},
    }));
    expect(html).toContain("같은 묶음을 다시 실행해도 결과는 같습니다");
    expect(html).not.toContain("<dl");
  });

  it("keeps the generic line for an unrelated failure", () => {
    expect(render({ state: "failed", errorCode: "CORE_V2_TIMEOUT", collectionId: null })).toContain("Our servers could not complete this");
  });
});
