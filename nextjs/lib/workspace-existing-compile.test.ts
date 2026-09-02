import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");

describe("existing immutable document compilation", () => {
  it("only offers OCR-qualified documents and requires at least two selections", () => {
    expect(source).toContain("doc.hasOcrJson ? (");
    expect(source).toContain("selectedDocumentIds.length < 2");
    expect(source).toContain("Compile selected documents");
  });

  it("submits only the selected document ids to the existing compile route", () => {
    expect(source).toContain("const documentIds = [...new Set(selectedDocumentIds)]");
    expect(source).toContain('body: JSON.stringify({ documentIds })');
    expect(source).toContain("Compiled World ready from");
    expect(source).not.toContain("candidatePromotion=false");
  });
});
