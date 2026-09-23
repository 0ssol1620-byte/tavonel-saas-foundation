import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPILER_SPECIMEN_SOURCE,
  COMPILER_SPECIMEN_STAGES,
  compilerSpecimenShouldAdvance,
  nextCompilerStage,
} from "./compiler-specimen";
import publicSample from "./explore-sample.w4.inputs.json";
import landingSnapshot from "./landing-v2-snapshot.json";
import landingAssets from "@/public/landing/v2/manifest.json";
import pageAssets from "@/public/explore-sample/pages/pages.manifest.json";

describe("homepage compiler specimen", () => {
  it("uses the five-stage Knowledge Compiler sequence", () => {
    expect(COMPILER_SPECIMEN_STAGES.map(stage => stage.label)).toEqual([
      "Page",
      "Structure",
      "Evidence",
      "Knowledge",
      "Intelligence",
    ]);
  });

  it("keeps one committed public-sample identity and exact region", () => {
    expect(COMPILER_SPECIMEN_SOURCE).toMatchObject({
      id: "apple-2026-q1-10-q",
      regionId: "apple-2026-q1-10-q-p4-r14",
      page: 4,
      bbox1000: [64, 476, 932, 538],
      digest:
        "sha256:7fe2683c59e0b48f6c112bc17b3900d907f64236c138d1dd32f40d544b1ba89f",
    });
    expect(COMPILER_SPECIMEN_SOURCE.excerpt).toContain(
      "Research and development 10,887 8,268"
    );

    const document = publicSample.find(
      entry => entry.documentId === COMPILER_SPECIMEN_SOURCE.id
    );
    const region = document?.regions?.find(
      entry => entry.regionId === COMPILER_SPECIMEN_SOURCE.regionId
    );
    expect(document?.inputSha256).toBe(COMPILER_SPECIMEN_SOURCE.digest);
    expect(document?.text).toContain(
      "(In millions, except number of shares"
    );
    expect(document?.text).toContain(
      `Research and development ${COMPILER_SPECIMEN_SOURCE.currentValue} ${COMPILER_SPECIMEN_SOURCE.priorValue}`
    );
    expect(region).toMatchObject({
      pageNumber1: COMPILER_SPECIMEN_SOURCE.page,
      bbox1000: [...COMPILER_SPECIMEN_SOURCE.bbox1000],
      text: COMPILER_SPECIMEN_SOURCE.excerpt,
      authority: "official",
    });

    const snapshot = landingSnapshot.tabs.find(
      tab => tab.source.digest === COMPILER_SPECIMEN_SOURCE.digest && tab.source.page === COMPILER_SPECIMEN_SOURCE.page
    );
    expect(snapshot?.region.bbox1000).toEqual([...COMPILER_SPECIMEN_SOURCE.bbox1000]);
    expect(snapshot?.answerExcerpt).toBe(COMPILER_SPECIMEN_SOURCE.excerpt);
    expect(snapshot?.rasters.crop).toMatchObject({ width: 1120, height: 103 });

    const page = pageAssets.pages.find(
      entry => entry.sourceSha256 === COMPILER_SPECIMEN_SOURCE.digest && entry.page === COMPILER_SPECIMEN_SOURCE.page
    );
    expect(page?.regions.some(entry =>
      entry.bbox1000.join(",") === COMPILER_SPECIMEN_SOURCE.bbox1000.join(",")
    )).toBe(true);

    const derivative = landingAssets.entries.find(entry =>
      entry.kind === "region" &&
      entry.page === COMPILER_SPECIMEN_SOURCE.page &&
      "bbox1000" in entry &&
      entry.bbox1000?.join(",") === COMPILER_SPECIMEN_SOURCE.bbox1000.join(",")
    );
    expect(derivative?.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ format: "avif", width: 1120, height: 103, sha256: "sha256:06c98d7a69382521dee9fed1915670c6a3e80ed529624efbcc571bdbb11e542d" }),
      expect.objectContaining({ format: "webp", width: 1120, height: 103, sha256: "sha256:22f00db6dcb867a01bb281c6232e3cb58e8bc3d31ab48a24923e7adfdd2e1647" }),
    ]));
  });

  it("plays once and terminates on Intelligence", () => {
    expect(
      COMPILER_SPECIMEN_STAGES.map((_, index) => nextCompilerStage(index))
    ).toEqual([1, 2, 3, 4, null]);
  });

  it("advances only while requested, visible, onscreen and motion-safe", () => {
    const base = {
      requested: true,
      reducedMotion: false,
      inView: true,
      documentVisible: true,
    };
    expect(compilerSpecimenShouldAdvance(base)).toBe(true);
    expect(compilerSpecimenShouldAdvance({ ...base, inView: false })).toBe(
      false
    );
    expect(
      compilerSpecimenShouldAdvance({ ...base, documentVisible: false })
    ).toBe(false);
    expect(compilerSpecimenShouldAdvance({ ...base, requested: false })).toBe(
      false
    );
    expect(
      compilerSpecimenShouldAdvance({ ...base, reducedMotion: true })
    ).toBe(false);
    expect(
      compilerSpecimenShouldAdvance({
        ...base,
        documentVisible: false,
        requested: true,
      })
    ).toBe(false);
    expect(
      compilerSpecimenShouldAdvance({
        ...base,
        documentVisible: true,
        requested: true,
      })
    ).toBe(true);
  });

  it("uses a forty-percent observer, no live region, and mobile-safe controls", () => {
    const component = readFileSync(
      new URL(
        "../components/landing-v2/compiler-specimen.tsx",
        import.meta.url
      ),
      "utf8"
    );
    const css = readFileSync(
      new URL(
        "../components/landing-v2/compiler-specimen.module.css",
        import.meta.url
      ),
      "utf8"
    );
    expect(component).toContain("IntersectionObserver");
    expect(component).toContain("intersectionRatio >= 0.4");
    expect(component).toContain('document.addEventListener("visibilitychange"');
    expect(component).toContain("apple-2026-q1-10-q-reference-p004-1080.avif");
    expect(component).toContain("apple-2026-q1-10-q-reference-p004-r64-476-932-538-1120.avif");
    for (const selector of [
      "sourceAsset",
      "fullPage",
      "regionCrop",
      "sourceCaption",
      "pageComposition",
      "structureComposition",
      "evidenceComposition",
      "knowledgeComposition",
      "intelligenceComposition",
    ]) {
      expect(component, `${selector} must be rendered`).toContain(`styles.${selector}`);
      expect(css, `${selector} must be styled`).toMatch(new RegExp(`\\.${selector}\\b`));
    }
    expect(component).not.toMatch(/aria-live|role=["']status/);
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.stage\s*\{[\s\S]*?min-height:\s*48px/
    );
    expect(css).toMatch(/\.specimen\s*\{[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.addressGrid b\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  });
});
