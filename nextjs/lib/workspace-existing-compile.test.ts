import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");

describe("existing immutable document compilation", () => {
  /*
    The floor moved from two documents to one, and both sides of it moved together.

    This used to assert the literal `selectedDocumentIds.length < 2`, which was the guard here
    and also, separately spelled, the guard in the compile route and in the compiler. Asserting
    the shared judgement instead is the point: a limit written in three places is a limit that
    will disagree with itself, which is how a customer came to upload 128 files and be refused
    after all of them had been read.
  */
  it("offers only OCR-qualified documents and judges the selection against the shared limit", () => {
    // Moved 2026-09-17 with BQ-093, same intent. The per-document tick left the second list of
    // names and moved onto the board row it applies to, so eligibility is one derivation on the
    // page -- still `hasOcrJson`, and still the only thing the board will let anyone tick.
    expect(source).toContain("documents?.filter((document) => document.hasOcrJson).map((document) => document.documentId)");
    expect(source).toContain("selectableIds={intakeOpen ? compilableDocumentIds : []}");
    expect(source).toContain("customerDataAccess={customerDataAccess}");
    expect(source).toContain("judgeCorpusSet(selectedDocumentIds.length).ok");
    // The sentence is now computed from what this browser can actually expand.
    expect(source).toContain("compileLimitsNotice(archiveCeilingMb)");
    expect(source).toContain("Compile selected documents");
    expect(source).not.toContain("selectedDocumentIds.length < 2");
  });

  it("submits only the selected document ids to the existing compile route", () => {
    expect(source).toContain("const documentIds = [...new Set(selectedDocumentIds)]");
    expect(source).toContain('body: JSON.stringify({ documentIds })');
    // The sentence moved to compiledWorldReadyNotice (lib/workspace-failure-copy.ts, WO-ENT-UX-1) so a
    // Core V2 run with no Topic concept never prints "0 topics"; the sentence itself is pinned in
    // workspace-failure-copy.test.ts and the page must still build its notice from the validation counts.
    expect(source).toContain("compiledWorldReadyNotice(result.validation.counts)");
    expect(source).not.toContain("candidatePromotion=false");
  });
});
