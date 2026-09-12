import { describe, expect, it } from "vitest";
import { boundedPixelRatio, publicPdfPath, sameSourcePage, sourceRectStyle, sourceScale, validSourceRect } from "./source-page-geometry";

describe("original-source presentation identity and geometry", () => {
  const identity = { sourceId: "apple-form-10-k", digest: "sha256:a", sourceVersionId: "v1", page: 4 };
  it("requires the same document, digest, source version AND page", () => {
    expect(sameSourcePage(identity, { ...identity })).toBe(true);
    for (const delta of [{ sourceId: "other" }, { digest: "sha256:b" }, { sourceVersionId: "v2" }, { page: 5 }]) expect(sameSourcePage(identity, { ...identity, ...delta })).toBe(false);
  });
  it.each([[0, 0, 1000, 1000], [30, 367, 970, 390]])("accepts normalized rectangle %s %s %s %s", (...rect) => expect(validSourceRect(rect)).toBe(true));
  it.each([[0, 0, 0, 100], [-1, 0, 10, 10], [0, 0, 1001, 10], [0, 900, 10, 800], [0, NaN, 10, 10]])("rejects unsupported rectangle %s %s %s %s", (...rect) => expect(validSourceRect(rect)).toBe(false));
  it("converts coordinates into a percentage of the complete uncropped page", () => {
    expect(sourceRectStyle([30, 367, 970, 390])).toEqual({ left: "3%", top: "36.7%", width: "94%", height: "2.3%" });
  });
  it("rejects private URLs, queries, traversals, HTML and third-party PDFs", () => {
    for (const href of ["https://example.com/a.pdf", "/api/files/a.pdf", "/explore-sample/../a.pdf", "/explore-sample/a.pdf?token=x", "/explore-sample/a.html", "//evil.test/a.pdf", "/explore-sample/a%2fp.pdf"]) expect(publicPdfPath(href)).toBeNull();
    expect(publicPdfPath("/explore-sample/apple-2025-form-10-k.pdf#page=4")).toBe("/explore-sample/apple-2025-form-10-k.pdf");
  });
  it("fits the entire page inside available space", () => {
    const scale = sourceScale(612, 792, 600, 560, 1);
    expect(612 * scale).toBeLessThanOrEqual(568); expect(792 * scale).toBeLessThanOrEqual(528);
  });
  it("rejects nonfinite dimensions and bounds zoom", () => {
    expect(() => sourceScale(0, 792, 600, 560, 1)).toThrow();
    expect(sourceScale(612, 792, 600, 560, 999)).toBe(sourceScale(612, 792, 600, 560, 4));
  });
  it("caps backing canvas memory at normal viewport sizes", () => {
    const ratio = boundedPixelRatio(2200, 3000, 3);
    expect(2200 * 3000 * ratio * ratio).toBeLessThanOrEqual(5_000_001);
  });
});
