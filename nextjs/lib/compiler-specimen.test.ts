import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPILER_SPECIMEN_SOURCE,
  COMPILER_SPECIMEN_STAGES,
  compilerSpecimenShouldAdvance,
  nextCompilerStage,
} from "./compiler-specimen";
import publicSample from "./explore-sample.w4.inputs.json";

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
    expect(region).toMatchObject({
      pageNumber1: COMPILER_SPECIMEN_SOURCE.page,
      bbox1000: [...COMPILER_SPECIMEN_SOURCE.bbox1000],
      text: COMPILER_SPECIMEN_SOURCE.excerpt,
      authority: "official",
    });
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
    expect(component).not.toMatch(/aria-live|role=["']status/);
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.stage\s*\{[\s\S]*?min-height:\s*44px/
    );
    expect(css).toMatch(/\.specimen\s*\{[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.fact dd\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  });
});
