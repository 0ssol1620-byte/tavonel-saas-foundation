import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WorldFreshness, { readWorldFreshness } from "@/components/world-freshness";

/*
  Audit TM04: four times, and the warning that a consumer is reading the previous World.

  The failure path is the whole risk here. The freshness block is produced elsewhere (the World
  read model), so this component meets absent, partial and malformed input in production before
  it ever meets a complete one, and the only safe answer to all three is to render nothing.
*/

const full = {
  observedAt: "2026-09-10T08:00:00.000Z",
  processedAt: "2026-09-10T09:30:00.000Z",
  reviewedAt: null,
  activatedAt: "2026-09-09T12:00:00.000Z",
  activeManifestDigest: `sha256:${"a".repeat(64)}`,
  candidateAwaitingActivation: true,
  candidateManifestDigest: `sha256:${"b".repeat(64)}`,
};

describe("reading the contract shape", () => {
  it("accepts the block the contract describes, nulls included", () => {
    expect(readWorldFreshness(full)).toEqual(full);
    expect(readWorldFreshness({
      observedAt: null, processedAt: null, reviewedAt: null, activatedAt: null,
      activeManifestDigest: null, candidateAwaitingActivation: false, candidateManifestDigest: null,
    })?.candidateAwaitingActivation).toBe(false);
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["an array", []],
    ["a string", "fresh"],
    ["missing the boolean", { observedAt: null, processedAt: null, reviewedAt: null, activatedAt: null, activeManifestDigest: null, candidateManifestDigest: null }],
    ["a boolean sent as a string", { ...full, candidateAwaitingActivation: "true" }],
    ["a timestamp sent as a number", { ...full, observedAt: 1_760_000_000 }],
  ])("refuses %s", (_label, value) => {
    expect(readWorldFreshness(value)).toBeNull();
  });
});

describe("the rendered block", () => {
  it("renders nothing at all when the read model has no freshness block", () => {
    expect(renderToStaticMarkup(createElement(WorldFreshness, { freshness: undefined }))).toBe("");
    expect(renderToStaticMarkup(createElement(WorldFreshness, { freshness: { candidateAwaitingActivation: "yes" } }))).toBe("");
  });

  it("names the four times and prints the waiting-candidate notice verbatim", () => {
    const markup = renderToStaticMarkup(createElement(WorldFreshness, { freshness: full }));
    for (const label of ["OBSERVED", "PROCESSED", "REVIEWED", "ACTIVE SINCE"]) expect(markup).toContain(label);
    expect(markup).toContain("A newer candidate is waiting for activation; consumers are reading the previous active World");
    expect(markup).toContain("10 Sept 2026, 08:00 UTC");
  });

  it("prints a missing time as not recorded rather than substituting one", () => {
    const markup = renderToStaticMarkup(createElement(WorldFreshness, { freshness: full }));
    expect(markup).toContain("not recorded");
    expect(markup).not.toContain("undefined");
    expect(markup).not.toContain("Invalid Date");
  });

  it("omits the waiting-candidate notice when no candidate is waiting", () => {
    const markup = renderToStaticMarkup(createElement(WorldFreshness, {
      freshness: { ...full, candidateAwaitingActivation: false, candidateManifestDigest: null },
    }));
    expect(markup).not.toContain("waiting for activation");
    expect(markup).toContain("ACTIVE SINCE");
  });
});
