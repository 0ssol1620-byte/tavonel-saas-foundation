import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exploreChangeBaselineDocument, exploreChangeStory } from "./explore-change";
import { exploreSampleAnswers, exploreSampleDocuments, exploreSampleWorld } from "./explore-sample";
import {
  DEEP_LINK_ACTS,
  EXPLORE_ACTS,
  EXPLORE_COPY,
  actFromQuery,
  buildExploreAnswerViews,
  buildExploreChangeView,
} from "./explore-story";
import { toVisualWorldModel } from "./visual-world-model";

/*
  What the stage is allowed to say, and what it is allowed to open.

  Three separate obligations live here. The first is the state machine: a deep link may only
  reach a state the stage can render, and anything else lands on the entry. The second is that
  the Change act's headline number is the same number the diff produced -- `reached` is
  re-derived here rather than trusted. The third is the copy rule.

  On the copy rule: SPEC 13.3's barred phrases and readiness overclaims are enforced repo-wide by
  `lib/brand-copy.test.ts` over a list of surfaces, and this lane's surfaces are not yet on that
  list -- adding the rows is a one-line edit to a file another lane owns this week. Rather than
  ship public copy that nothing checks, the same two lists are applied here to the files this
  lane added. When the rows land in COPY_SURFACES this block becomes redundant and should be
  deleted, not kept as a second source of truth.
*/

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

const SURFACES = [
  "lib/explore-story.ts",
  "app/explore/page.tsx",
  "components/explore/explore-stage.tsx",
  "components/explore/world-act.tsx",
  "components/explore/evidence-act.tsx",
  "components/explore/change-act.tsx",
  "components/explore/ask-overlay.tsx",
  "components/explore/technical-details.tsx",
  "components/world-visual/world-canvas.tsx",
  "components/world-visual/source-sheet.tsx",
  "components/world-visual/page-region.tsx",
];

const BARRED = ["unlock your data", "second brain", "100% accurate", "never hallucinates", "better than rag", "ai brain"];
const OVERCLAIMS = ["generally available", "production-ready", "fully automated ontology"];

const model = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const change = buildExploreChangeView(exploreChangeStory, exploreChangeBaselineDocument);

describe("the act a link may ask for", () => {
  it("accepts the three deep-linkable acts", () => {
    expect(Object.keys(DEEP_LINK_ACTS)).toEqual(["world", "evidence", "change"]);
    for (const [query, act] of Object.entries(DEEP_LINK_ACTS)) expect(actFromQuery(query)).toBe(act);
  });

  it("resolves every rail entry to the state that rail entry draws", () => {
    // The rail and the URL are two ways into the same six states (§4.2). A rail entry whose
    // query string resolved somewhere else would make `/explore?act=x` and clicking X two
    // different things.
    for (const entry of EXPLORE_ACTS) expect(actFromQuery(entry.query)).toBe(entry.act);
  });

  it("sends everything else to the entry", () => {
    const rejected = [
      undefined,
      "",
      "ask",
      // The internal state names are not link targets; only the three query words are.
      "object_focus",
      "change_compare",
      "entry",
      "WORLD",
      "../admin",
      // A prototype key is a string that resolves on any object literal. It must not name an act.
      "constructor",
      "toString",
      ["change", "world"],
    ];
    for (const value of rejected) {
      expect(actFromQuery(value as string | string[] | undefined), String(value)).toBe(
        Array.isArray(value) ? "change_compare" : "entry",
      );
    }
  });
});

describe("the Change act's numbers are the diff's numbers", () => {
  it("re-derives the headline count from the three partitions", () => {
    expect(change.reached).toBe(change.counts.added + change.counts.removed + change.counts.rebuilt);
    expect(change.reached).toBe(exploreChangeStory.affectedNodeIds.length);
    expect(change.counts.untouched).toBe(exploreChangeStory.untouchedNodeIds.length);
  });

  it("names the baseline and every arrival by the file that is in the repository", () => {
    expect(change.baseline.filename).toBe(exploreChangeBaselineDocument.filename);
    expect(change.baseline.manifestDigest).not.toBe(change.after.manifestDigest);
    expect(change.arrivals.map((arrival) => arrival.documentId))
      .toEqual(exploreChangeStory.arrivals.map((arrival) => arrival.documentId));
    // One arriving filing is one new source version; the view refuses to build if they disagree.
    expect(change.arrivals.length).toBe(change.sourceRevisions.added);
    for (const arrival of change.arrivals) {
      expect(arrival.filename, arrival.documentId).toBeTruthy();
      expect(arrival.excerpt.length, arrival.documentId).toBeGreaterThan(0);
    }
  });

  it("shows objects named by the full-world diff without requiring a fabricated carry-over", () => {
    const affected = new Set(change.affectedNodeIds);
    expect(model.focus.some((id) => affected.has(id))).toBe(true);
    if (change.untouchedNodeIds.length === 0) expect(change.counts.untouched).toBe(0);
  });

  it("claims no equivalence and shows no PASS", () => {
    expect(change.equivalence.state).toBe("not_yet");
    // Comments in the act discuss the badge by name in order to say why it is absent, so the
    // check runs against the source with its own rationale stripped out.
    const rendered = read("components/explore/change-act.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    expect(rendered).not.toMatch(/\bPASS\b/);
    expect(rendered).not.toContain("not_yet");
    expect(EXPLORE_COPY.equivalenceLead).toContain("two complete compiles");
  });
});

describe("every citation the Ask offers can be opened", () => {
  const views = buildExploreAnswerViews(exploreSampleAnswers, model.evidence);

  it("resolves each cited region to a region the stage can render", () => {
    const ids = new Set(model.evidence.map((item) => item.id));
    expect(views).toHaveLength(exploreSampleAnswers.length);
    for (const view of views) {
      expect(view.regions.length).toBeGreaterThan(0);
      for (const region of view.regions) expect(ids.has(region.evidenceId), region.evidenceId).toBe(true);
    }
  });

  it("quotes the source rather than composing an answer", () => {
    for (const view of views) expect(view.answer).toBe(view.regions[0].excerpt);
  });

  it("has an object to select for every cited region", () => {
    for (const view of views) {
      for (const region of view.regions) {
        expect(
          model.nodes.some((node) => node.evidenceRefs.includes(region.evidenceId)),
          region.evidenceId,
        ).toBe(true);
      }
    }
  });
});

describe("public copy on this lane's surfaces", () => {
  it.each(SURFACES)("keeps every barred phrase out of %s", (surface) => {
    const source = read(surface).toLowerCase();
    for (const phrase of BARRED) expect(source, `SPEC 13.3 bars "${phrase}"`).not.toContain(phrase);
  });

  it.each(SURFACES)("makes no readiness overclaim in %s", (surface) => {
    const source = read(surface).toLowerCase();
    for (const phrase of OVERCLAIMS) expect(source, phrase).not.toContain(phrase);
  });

  it("labels the sample once, in the header", () => {
    // Masterplan 13.9: a sample says so once. Twice is the defensiveness that made the strongest
    // page on the site read as the weakest, so the words exist in exactly one place and are
    // rendered from exactly one reference.
    expect(EXPLORE_COPY.badge).toBe("INTERACTIVE SAMPLE");
    const literals = SURFACES.reduce(
      (total, surface) => total + (read(surface).match(/INTERACTIVE SAMPLE/g) ?? []).length,
      0,
    );
    expect(literals).toBe(1);
    expect(read("components/explore/explore-stage.tsx").match(/EXPLORE_COPY\.badge/g)).toHaveLength(1);
  });

  it("says TAVONEL and never the campaign name", () => {
    for (const surface of SURFACES) expect(read(surface)).not.toContain("FOLYNTA");
  });

  it("opens with the copy the blueprint asks for", () => {
    expect(EXPLORE_COPY.hero).toBe("Step inside a Compiled World.");
    expect(EXPLORE_COPY.enter).toBe("ENTER WORLD");
    expect(EXPLORE_COPY.worldHint).toBe("SELECT AN OBJECT");
    expect(EXPLORE_COPY.endHeading).toBe("Try the same path with your own knowledge.");
  });
});
