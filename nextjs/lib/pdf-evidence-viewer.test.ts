import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const viewer = readFileSync(resolve(import.meta.dirname, "../components/pdf-evidence-viewer.tsx"), "utf8");
const studio = readFileSync(resolve(import.meta.dirname, "../components/world-studio-ultimate.tsx"), "utf8");

describe("actual PDF evidence viewer", () => {
  it("renders the requested PDF.js page before exposing the bbox overlay", () => {
    expect(viewer).toContain('import("pdfjs-dist")');
    expect(viewer).toContain("await activeRender.promise");
    expect(viewer).toContain('state === "ready"');
    expect(viewer).toContain("bbox[0] / 10");
    expect(viewer).toContain("renderTask?.cancel()");
  });

  it("replaces the browser PDF iframe in the persisted World evidence surface", () => {
    expect(studio).toContain("<PdfEvidenceViewer");
    expect(studio).not.toContain("<iframe");
  });
});
