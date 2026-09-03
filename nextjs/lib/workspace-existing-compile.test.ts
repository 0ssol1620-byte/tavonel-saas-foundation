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
    expect(source).toContain("doc.hasOcrJson ? (");
    expect(source).toContain("judgeCompileSet(selectedDocumentIds.length).ok");
    // The sentence is now computed from what this browser can actually expand.
    expect(source).toContain("compileLimitsNotice(archiveCeilingMb)");
    expect(source).toContain("Compile selected documents");
    expect(source).not.toContain("selectedDocumentIds.length < 2");
  });

  it("submits only the selected document ids to the existing compile route", () => {
    expect(source).toContain("const documentIds = [...new Set(selectedDocumentIds)]");
    expect(source).toContain('body: JSON.stringify({ documentIds })');
    expect(source).toContain("Compiled World ready from");
    expect(source).not.toContain("candidatePromotion=false");
  });
});
