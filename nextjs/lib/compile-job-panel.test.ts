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
