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

  it("says the bound was exceeded, not '?', when the read stopped at the bound", () => {
    // D0 2026-11-09: a Core response streamed past 80 MiB is cut there, so bytes is null; only "more than" is known.
    const cut = { bytes: null, bound: 83_886_080, largestPackageFiles: [], counts: {} };
    const failed = { ...job, state: "failed" as const, errorCode: "CORE_OUTPUT_TOO_LARGE", collectionId: null, sizeLimit: cut };
    const en = render(failed);
    expect(en).toContain("exceeded the 83,886,080 byte limit");
    expect(en).not.toContain("?");
    expect(en).not.toContain("/ 83,886,080");
    const ko = renderToStaticMarkup(createElement(CompileJobPanel, { job: failed, languages: ["ko-KR"], onResolve() {}, onCancel() {} }));
    expect(ko).toContain("83,886,080 바이트 상한 초과");
    expect(ko).not.toContain("?");
  });

  it("keeps the generic line for an unrelated failure", () => {
    expect(render({ state: "failed", errorCode: "CORE_V2_TIMEOUT", collectionId: null })).toContain("Our servers could not complete this");
  });
});

/*
  F1 and F4 (COMPILE-RELIABILITY-20261109 R3, R4). A job waiting on the customer said "Reading the
  sources." over a reader that had stopped, and offered a Retry that cannot read an operator-review
  file again. The title says who is waiting now, and Retry is off when no file could change.
*/
describe("a job waiting on the customer's decision", () => {
  const review = { documentId: "doc-a", kind: "input" as const, reason: "READING_NEEDS_OPERATOR_REVIEW" };
  const waiting = (blocked: CompileJobView["blocked"], languages: string[] = []) => renderToStaticMarkup(createElement(CompileJobPanel, {
    job: { ...job, state: "reading", documentsTotal: blocked.length, documentsReady: 0, blocked, collectionId: null },
    languages, onResolve() {}, onCancel() {},
  }));
  const retryButton = (html: string) => /<button[^>]*>Retry what can be retried<\/button>/.exec(html)?.[0] ?? "";

  it("titles the panel as waiting for a decision, not reading, and says when the wait ends", () => {
    const html = waiting([review]);
    expect(html).toContain("Waiting for your decision.");
    expect(html).not.toContain("Reading the sources.");
    expect(html).toContain("If nothing is chosen within 7 days, this compile stops.");
  });

  it("turns Retry off for an operator-review file and says it has to be uploaded again", () => {
    const html = waiting([review]);
    expect(retryButton(html)).toContain("disabled");
    expect(html).toContain("Retry does not read this file again. Remove it, then upload it again.");
    // Remove and Cancel stay available: they are the way out.
    expect(html).toMatch(/<button type="button">Remove the 1 blocked<\/button>/);
    expect(html).toMatch(/<button type="button">Cancel<\/button>/);
  });

  it("keeps Retry for a file that may still arrive, beside one that cannot be read again", () => {
    const html = waiting([review, { documentId: "doc-b", kind: "input", reason: "READING_DID_NOT_FINISH" }]);
    expect(retryButton(html)).not.toContain("disabled");
    expect(html).toContain("Retry does not read this file again.");
  });

  it("does not guess about an unknown blocker reason: Retry stays, the code is shown in words, the title is still true", () => {
    const html = waiting([{ documentId: "doc-c", kind: "input", reason: "SOME_NEW_REASON" }]);
    expect(retryButton(html)).not.toContain("disabled");
    expect(html).toContain("some new reason");
    expect(html).toContain("Waiting for your decision.");
    expect(html).not.toContain("upload it again");
  });

  it("speaks Korean when the browser does, without semicolons", () => {
    const html = waiting([review, { ...review, documentId: "doc-b" }], ["ko-KR"]);
    expect(html).toContain("결정을 기다리고 있습니다.");
    expect(html).toContain("다시 시도해도 이 파일 2개는 다시 읽지 않습니다. 제거한 뒤 다시 올려 주세요.");
    expect(html).toContain("7일 안에 선택하지 않으면 이 컴파일은 멈춥니다.");
    expect(html).not.toContain("Reading the sources.");
  });

  it("goes back to the reading title once the customer has answered", () => {
    const html = renderToStaticMarkup(createElement(CompileJobPanel, {
      job: { ...job, state: "reading", documentsTotal: 2, documentsReady: 1, blocked: [review], blockedResolution: "continue", collectionId: null },
      onResolve() {}, onCancel() {},
    }));
    expect(html).toContain("Reading the sources.");
    expect(html).not.toContain("Waiting for your decision.");
  });
});
