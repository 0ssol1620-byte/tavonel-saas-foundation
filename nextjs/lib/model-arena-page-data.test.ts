import { describe, expect, it } from "vitest";
import artifact from "../content/benchmarks/model-arena-20260903.json";
import {
  ARENA_STATUSES,
  arenaBars,
  arenaDots,
  arenaModel,
  modelArenaBoard,
  settledModels,
  unsettledModels,
  validateArenaArtifact,
  type ArenaStatus,
} from "./model-arena-page-data";

/*
  The guard over what /benchmarks is allowed to render.

  `model-arena-artifact-builder.test.ts` holds the artifact's provenance -- that it is a fresh
  build of the campaign and that its sha256 is the one this module pins. What is checked here is
  the refusal set: the four shapes of bad artifact that would otherwise render as a page of
  confident-looking bars.
*/

/** A deep copy the tests may break, so no test mutates the committed board for the next one. */
const clone = () => JSON.parse(JSON.stringify(artifact)) as Record<string, unknown> & {
  models: Record<string, unknown>[];
  sources: Record<string, unknown>[];
};

describe("validateArenaArtifact", () => {
  it("accepts the committed artifact", () => {
    expect(validateArenaArtifact(artifact)).toEqual([]);
  });

  it("refuses a quality row with no page count", () => {
    const bad = clone();
    delete (bad.models[0]!.omnidoc as Record<string, unknown>).pages;
    expect(validateArenaArtifact(bad)).toContain(
      `artifact.models.${bad.models[0]!.key}.omnidoc: missing denominator (pages)`,
    );
  });

  it("refuses a page count of zero, which is a denominator nothing can be a rate over", () => {
    const bad = clone();
    (bad.models[0]!.omnidoc as Record<string, unknown>).pages = 0;
    expect(validateArenaArtifact(bad).join(";")).toMatch(/missing denominator \(pages\)/);
  });

  it("refuses a median with no timed-page count behind it", () => {
    const bad = clone();
    const row = bad.models.find((model) => (model.speed as { median_seconds_per_page: number | null }).median_seconds_per_page !== null)!;
    (row.speed as Record<string, unknown>).timed_pages = null;
    expect(validateArenaArtifact(bad)).toContain(
      `artifact.models.${row.key}.speed: median without a denominator (timed_pages)`,
    );
  });

  it("refuses a negative figure", () => {
    const bad = clone();
    (bad.models[0]!.omnidoc as Record<string, unknown>).text_edit = -0.01;
    expect(validateArenaArtifact(bad)).toContain(
      `artifact.models.${bad.models[0]!.key}.omnidoc.text_edit: negative figure`,
    );
  });

  it("refuses a figure outside 0..1 and a non-positive rate", () => {
    const bad = clone();
    (bad.models[0]!.omnidoc as Record<string, unknown>).table_teds = 1.4;
    (bad.models[0]!.speed as Record<string, unknown>).median_seconds_per_page = 0;
    const problems = validateArenaArtifact(bad).join(";");
    expect(problems).toMatch(/table_teds: figure outside 0\.\.1/);
    expect(problems).toMatch(/median_seconds_per_page: not a positive rate/);
  });

  it("refuses an unknown status", () => {
    const bad = clone();
    bad.models[0]!.status = "great";
    expect(validateArenaArtifact(bad)).toContain(
      `artifact.models.${bad.models[0]!.key}.status: unknown status great`,
    );
  });

  it("refuses a duplicate model key", () => {
    const bad = clone();
    bad.models.push(JSON.parse(JSON.stringify(bad.models[0])));
    expect(validateArenaArtifact(bad)).toContain(
      `artifact.models.${bad.models[0]!.key}: duplicate model key`,
    );
  });

  it("refuses a source that is not bound by a sha256", () => {
    const bad = clone();
    bad.sources[0]!.sha256 = "not-a-digest";
    expect(validateArenaArtifact(bad)).toContain(
      `artifact.sources.${bad.sources[0]!.path}: not bound by a sha256`,
    );
  });

  it("refuses an artifact with no sources and one with no rows", () => {
    expect(validateArenaArtifact({ ...clone(), sources: [] })).toContain("artifact.sources: no source is bound");
    expect(validateArenaArtifact({ ...clone(), models: [] })).toContain("artifact.models: no model rows");
  });
});

describe("the board this page reads", () => {
  it("throws on a model key the artifact does not carry, rather than returning a blank row", () => {
    expect(() => arenaModel("gpt-does-not-exist")).toThrowError(/model_arena_unknown_model/);
    expect(arenaModel("ovisocr2").key).toBe("ovisocr2");
  });

  it("carries every status the page knows how to render, and no other", () => {
    for (const model of modelArenaBoard().models) {
      expect(ARENA_STATUSES).toContain(model.status as ArenaStatus);
    }
  });

  it("separates the settled rows from the ones the campaign did not settle", () => {
    const settled = settledModels();
    const unsettled = unsettledModels();
    expect(settled.length).toBeGreaterThan(0);
    expect(unsettled.length).toBeGreaterThan(0);
    expect(settled.length + unsettled.length).toBe(modelArenaBoard().models.length);
    for (const model of unsettled) expect(model.status).not.toBe("settled");
  });

  it("keeps the campaign's own order rather than re-ranking a board", () => {
    const order = modelArenaBoard().models.map((model) => model.key);
    expect(settledModels().map((model) => model.key)).toEqual(
      order.filter((key) => arenaModel(key).status === "settled"),
    );
  });

  it("states a reason for every row it did not settle", () => {
    for (const model of unsettledModels()) {
      expect(`${model.status_note ?? ""}${model.notes.join(" ")}`.length).toBeGreaterThan(0);
    }
  });
});

describe("the chart geometry", () => {
  it("draws every bar as its figure's share of the chart's own maximum", () => {
    const bars = arenaBars("text_edit");
    const max = Math.max(...bars.map((bar) => bar.value));
    for (const bar of bars) {
      expect(bar.fraction).toBeCloseTo(bar.value / max, 12);
      expect(bar.fraction).toBeGreaterThan(0);
      expect(bar.fraction).toBeLessThanOrEqual(1);
    }
    expect(bars.some((bar) => bar.fraction === 1)).toBe(true);
  });

  it("carries the denominator onto every bar", () => {
    for (const bar of arenaBars("table_teds")) expect(bar.pages).toBeGreaterThan(0);
  });

  it("plots only the rows that have both a quality and a speed reading", () => {
    const dots = arenaDots();
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(dot.secondsPerPage).toBeGreaterThan(0);
      expect(dot.timedPages).toBeGreaterThan(0);
      expect(dot.pages).toBeGreaterThan(0);
    }
    /* A model missing from the speed board is absent from the plot, never plotted at zero. */
    const missing = settledModels().filter((model) => model.speed.median_seconds_per_page === null);
    for (const model of missing) {
      expect(dots.map((dot) => dot.key)).not.toContain(model.key);
    }
  });

  it("refuses to draw a chart with no scale", () => {
    expect(() => arenaBars("text_edit", [])).toThrowError(/model_arena_chart_has_no_scale/);
  });
});
