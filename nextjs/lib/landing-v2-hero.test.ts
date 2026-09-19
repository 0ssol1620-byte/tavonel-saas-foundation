import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exploreChangeBaselineDocument, exploreChangeStory } from "./explore-change";
import { EXPLORE_SAMPLE_QUESTIONS, exploreSampleDocuments } from "./explore-sample";
import { LANDING_V2_COPY } from "./landing-v2-copy";
import { buildHeroScene } from "./landing-v2-hero";

/*
  The hero is the one composition on this site that has to be true at a glance, so every figure
  in it is pinned to the artifact it was read from.

  The three pins below are the /explore entry proof -- Apple's 2025 Form 10-K, page 4, the
  Company Background paragraph, at the per-mille box the compiler emitted. They are pinned rather
  than derived a second time: `lib/explore-entry-proof.ts` chooses by structure and could choose
  differently after a corpus change, and when it does the hero's source page, its committed
  render and its crop all have to move together. A failing pin is the signal to re-run
  `scripts/build-landing-v2-assets.mjs` and re-read this, not to loosen the assertion.
*/
const HERO_REGION_ID = "evidence-0dffdde3c8def7d25da7d9eb4bd303d3:chunk-a511a0ea39e95b6dd5872ac3ef0115f1";
const HERO_BBOX = [30, 291, 971, 380];
const HERO_DIGEST = "sha256:108590052c3ba5400c63660d787fe7ed4e43868292946d7a7facebe9ab7d1aab";

const scene = buildHeroScene();
const root = join(import.meta.dirname, "..");

describe("the Landing V2 hero scene", () => {
  it("opens on the region /explore opens on", () => {
    expect(scene.region.id).toBe(HERO_REGION_ID);
    expect(scene.region.bbox1000).toEqual(HERO_BBOX);
    expect(scene.source.digest).toBe(HERO_DIGEST);
    expect(scene.source.form).toBe("10-K");
    expect(scene.source.page).toBe(4);
    expect(scene.source.representationKind).toBe("original");
    /*
      The measurement, and only the measurement.

      §4.1's label used to be assembled here -- `SOURCE · 10-K · p.4 · [...]` -- with its unit
      beside it, which is how `/ko` came to print both in English. The words are now
      `hero.regionLabelFormat` and `evidence.regionUnit` in `lib/landing-v2-copy.ts`, in both
      languages, and what this module returns is the box the compiler stored.
    */
    expect(scene.region.coordinates).toBe(`[30,291 → 971,380]`);
  });

  /*
    And the words that go around it exist in both languages, with the record's slots in them.

    Pinned here rather than in the copy test because this is the seam: a format that stopped
    naming `{coordinates}` would render a label with a hole in it, and a data module that went
    back to assembling the sentence would put English on the Korean page again.
  */
  it("leaves §4.1's label to the copy deck, which spells it in both languages", () => {
    for (const locale of ["en", "ko"] as const) {
      const hero = LANDING_V2_COPY[locale].hero;
      for (const slot of ["{form}", "{page}", "{coordinates}"]) {
        expect(hero.regionLabelFormat, `${locale} label drops ${slot}`).toContain(slot);
      }
      for (const slot of ["{page}", "{pageCount}"]) {
        expect(hero.pageOfFormat, `${locale} page connective drops ${slot}`).toContain(slot);
      }
      expect(LANDING_V2_COPY[locale].evidence.regionUnit.length).toBeGreaterThan(0);
    }
    // The Korean forms are Korean, which is the defect this seam exists to have fixed.
    expect(LANDING_V2_COPY.ko.hero.regionLabelFormat).toMatch(/[가-힣]/);
    expect(LANDING_V2_COPY.ko.hero.pageOfFormat).toMatch(/[가-힣]/);
    expect(LANDING_V2_COPY.ko.evidence.regionUnit).toMatch(/[가-힣]/);
  });

  it("paints a derivative of a committed render, at a declared size", () => {
    for (const [label, src, srcSet, width, height] of [
      ["page", scene.source.rasterSrc, scene.source.rasterSrcSet, scene.source.width, scene.source.height],
      ["crop", scene.region.cropSrc, scene.region.cropSrcSet, scene.region.cropWidth, scene.region.cropHeight],
    ] as const) {
      expect(src, `${label} src`).toMatch(/^\/landing\/v2\/.+\.webp$/);
      expect(srcSet, `${label} srcSet`).toContain(`${width}w`);
      expect(width, `${label} width`).toBeGreaterThan(0);
      expect(height, `${label} height`).toBeGreaterThan(0);
    }
  });

  it("carries the compiled object that region states, with the World's own state", () => {
    expect(scene.compiled.kind).toBe("Claim");
    expect(scene.compiled.label.startsWith("Business Company Background")).toBe(true);
    expect(scene.compiled.excerpt.length).toBeLessThanOrEqual(240);
    // Not "verified". The sample World is a deterministic published sample, and the hero says
    // the state the World gives the object rather than the one the storyboard wanted (§11.3).
    expect(scene.compiled.state).toBe("candidate");
    expect(scene.compiled.evidenceCount).toBeGreaterThan(0);
  });

  it("shows at most three real relations, each attributed to the node it leaves", () => {
    expect(scene.related.length).toBeGreaterThan(0);
    expect(scene.related.length).toBeLessThanOrEqual(3);
    for (const relation of scene.related) {
      expect(relation.predicate.length, relation.id).toBeGreaterThan(0);
      expect(relation.via.length, relation.id).toBeGreaterThan(0);
      expect(relation.id).not.toBe(scene.compiled.nodeId);
    }
    expect(new Set(scene.related.map((relation) => relation.id)).size).toBe(scene.related.length);
    /*
      Topics, not heuristic Entities. `EXPLORE_COPY.entityDisclaimer` publishes that the Entity
      labels in this sample come from a capitalised-token heuristic with three true positives out
      of sixteen evaluated, and ranking on degree alone drew "Form" and "Pro" into the hero. If
      this pin fails because an Entity came back, the ranking regressed -- not the corpus.
    */
    expect(scene.related.map((relation) => relation.kind)).toEqual(["Topic", "Topic", "Topic"]);
    expect(scene.related.map((relation) => relation.label)).toEqual(["Governance", "Security", "Research"]);
    expect(new Set(scene.related.map((relation) => relation.predicate))).toEqual(new Set(["discusses_topic"]));
  });

  it("states the change counts the comparison measured, and nothing else", () => {
    expect(scene.change.counts).toEqual(exploreChangeStory.counts);
    expect(scene.change.arrivals).toHaveLength(exploreChangeStory.arrivals.length);
    for (const [index, arrival] of scene.change.arrivals.entries()) {
      expect(arrival.form).toBe(exploreChangeStory.arrivals[index].form);
      expect(arrival.filingDate).toBe(exploreChangeStory.arrivals[index].filingDate);
    }
  });

  /*
    THE SNAPSHOT STEP IS MEASURED, NOT TYPED, and this is the guard that keeps it so.

    `exploreChangeStory.before.label` and `.after.label` are string literals in
    `lib/explore-change.ts` -- "2025 Form 10-K" and "2025 Form 10-K + four 2026 filings" -- and
    the hero passed them straight to `RevisionBadge`, which renders both inside
    `data-derived="1"`: the attribute `e2e/landing-v2.spec.ts` accepts as proof that a digit was
    measured. The count word and both years were certified by a guard that had measured nothing,
    and a fifth entry in `exploreSampleInputs` would have rendered five arrivals under a label
    still saying four with everything green.

    What crosses the boundary now is the baseline filing's own form and year, and the count in
    the after label is `arrivals.length` -- the same array the badge lists underneath it.
  */
  it("derives the snapshot step from the filings rather than from a typed label", () => {
    const baselineFiled = exploreChangeBaselineDocument.filingDate ?? "";
    expect(scene.change.before.form).toBe(exploreChangeBaselineDocument.form);
    expect(scene.change.before.year).toBe(baselineFiled.slice(0, 4));

    for (const locale of ["en", "ko"] as const) {
      const recompile = LANDING_V2_COPY[locale].recompile;
      for (const slot of ["{year}", "{form}"]) {
        expect(recompile.snapshotBeforeFormat, `${locale} before label drops ${slot}`).toContain(slot);
      }
      for (const slot of ["{before}", "{count}"]) {
        expect(recompile.snapshotAfterFormat, `${locale} after label drops ${slot}`).toContain(slot);
      }
    }

    // The printed count is the length of the list under it, not a word that agrees with it today.
    const before = LANDING_V2_COPY.en.recompile.snapshotBeforeFormat
      .replace("{year}", scene.change.before.year)
      .replace("{form}", scene.change.before.form);
    const after = LANDING_V2_COPY.en.recompile.snapshotAfterFormat
      .replace("{before}", before)
      .replace("{count}", String(scene.change.arrivals.length));
    expect(before).toContain(baselineFiled.slice(0, 4));
    expect(after).toContain(String(exploreChangeStory.arrivals.length));

    // And every arrival really is later than the filing it arrived on top of.
    for (const arrival of scene.change.arrivals) {
      expect(arrival.filingDate > baselineFiled, `${arrival.form} ${arrival.filingDate}`).toBe(true);
    }
  });

  /*
    §57, the two-numbers rule, held as a precondition rather than met with a second figure.

    `HeroSource` carries `pageCount` alone and the hero prints "p.4 of 80", where
    `explore-stage`, `change-act`, `technical-details`, `world-diff-sample` and `source-sheet`
    all print compiled-of-total. That is only true while the entry proof's filing is compiled
    whole; `chooseExploreEntryProof` is free to move to a 10-Q, which are 36 of 37 and 38 of 40,
    and the hero would then read a slice as the whole filing. `buildHeroScene()` throws in that
    case, and this is the pin that records why.
  */
  it("prints one page count because the World holds the whole filing", () => {
    const document = exploreSampleDocuments.find((entry) => entry.digest === scene.source.digest);
    expect(document?.compiledPageCount).toBe(scene.source.pageCount);
  });

  /*
    The noun over the four counts is the partition's, not one side of it.

    `untouched` is by construction the objects the arrivals did NOT reach --
    `lib/explore-change.ts` builds `untouchedNodeIds` as the complement of `affectedNodeIds`, and
    `explore-change.test.ts` asserts the two never overlap -- so heading that list
    `affectedLabel` ("Objects the arrivals reached") states the opposite of the data for the
    structurally largest of the four, and a screen reader read the row as "Objects the arrivals
    reached, list, N untouched". Asserted against the component's source because the heading is
    markup rather than data.
  */
  it("heads the hero counts with the comparison's noun, never the affected set's", () => {
    const demo = readFileSync(join(root, "components", "landing-v2", "hero-compiler-demo.tsx"), "utf8");
    const heading = demo.slice(demo.indexOf("lv2-counts-title"), demo.indexOf("lv2-counts-list"));
    expect(heading).toContain("copy.recompile.compareLabel");
    expect(heading).not.toContain("copy.recompile.affectedLabel");
    for (const locale of ["en", "ko"] as const) {
      const recompile = LANDING_V2_COPY[locale].recompile;
      expect(recompile.compareLabel).not.toBe(recompile.affectedLabel);
      expect(recompile.compareLabel.length).toBeGreaterThan(0);
    }
  });

  it("asks one of the four prepared questions and cites a real region", () => {
    expect(EXPLORE_SAMPLE_QUESTIONS).toContain(scene.ask.question);
    expect(scene.ask.citation.regionId.length).toBeGreaterThan(0);
    expect(scene.ask.citation.page).toBeGreaterThan(0);
    expect(scene.ask.citation.excerptPreview.length).toBeGreaterThan(0);
    expect(scene.ask.citation.excerptPreview.length).toBeLessThanOrEqual(240);
    // "What changed?" is answerable by the Change act, not by this lexical retriever.
    expect(scene.ask.question.toLowerCase()).not.toContain("what changed");
  });

  it("deep-links into the acts /explore can actually resolve", () => {
    expect(scene.links.evidence).toBe(`/explore?act=evidence&evidence=${encodeURIComponent(HERO_REGION_ID)}`);
    expect(scene.links.change).toBe("/explore?act=change");
    expect(scene.links.world).toBe("/explore?act=world");
  });

  it("is small enough to cross the RSC boundary", () => {
    expect(JSON.stringify(scene).length).toBeLessThan(12_000);
  });

  /*
    No typed digit, anywhere in the module.

    Every figure the hero shows -- the page number, the box, the counts, the filing dates -- is
    read from the compiled World at build time. The structural form of that rule is that there is
    nowhere in this module to type one: no string literal and no template chunk in the source
    contains a digit. A figure can therefore only reach the hero through the data.
  */
  it("types no figure into any label", () => {
    const source = readFileSync(join(root, "lib", "landing-v2-hero.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ")
      // Module specifiers are paths, not copy, and this module's siblings are named "-v2-".
      .replace(/^import[\s\S]*?from\s+["'][^"']*["'];/gm, " ");
    const literals = (source.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [])
      // Fail-closed error codes are diagnostics, not copy; they carry the module's own name.
      .filter((literal) => !literal.includes("landing_v2_"));
    for (const literal of literals) {
      const text = literal.startsWith("`") ? literal.replace(/\$\{[^}]*\}/g, "") : literal;
      expect(/\d/.test(text), `a figure is typed into the hero module: ${literal}`).toBe(false);
    }
    // And the fields that are not read from the World carry none either.
    for (const [label, text] of [
      ["compiled.kind", scene.compiled.kind],
      ["compiled.state", scene.compiled.state],
      ["source.representationKind", scene.source.representationKind],
    ] as const) {
      expect(/\d/.test(text), `${label} states a figure: ${text}`).toBe(false);
    }
  });

  /*
    The server boundary, asserted rather than declared.

    `server-only` is not installed in this tree, and this module pulls the collection compiler and
    `node:crypto`. A `"use client"` file importing it would ship both to the browser, so the
    import graph is walked instead.
  */
  it("is never imported by a client component", () => {
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          walk(path);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
          const text = readFileSync(join(root, path), "utf8");
          if (!/^\s*["']use client["']/m.test(text)) continue;
          /*
            Type-only imports are struck out first. They are erased before the bundle is written,
            so they ship neither the collection compiler nor `node:crypto` -- and the hero demo is
            a client component that has to name `HeroScene` to receive one as a prop. The rule is
            about the module reaching the browser, not about its types being spelled. A mixed
            import (`import { type X, buildHeroScene }`) is a value import and still fails here.
          */
          const runtime = text.replace(/^\s*import\s+type\s[^;]*;/gm, "");
          if (/from\s+["'][^"']*landing-v2-(hero|proof)["']/.test(runtime)) offenders.push(path);
        }
      }
    };
    for (const directory of ["app", "components", "lib"]) walk(directory);
    expect(offenders, "a client component imports a server-only landing module").toEqual([]);
  });
});
