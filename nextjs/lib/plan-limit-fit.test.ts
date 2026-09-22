import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPILE_MAX_DOCUMENTS, CORPUS_MAX_DOCUMENTS } from "./compile-limits";
import { corpusFit, LIMIT_STATE_GLYPH, LIMIT_STATE_LABEL, type LimitState } from "./plan-limit-fit";
import { MAX_QUOTED_PAGES } from "./usage-pricing";
import { BILLING_OFFERS } from "./billing-catalog";
import { PROCESSING_CEILING } from "../../shared/intakeCeiling";

/*
  THE VALIDATOR FOR GAP #5.

  The comparator's whole claim is that no figure in it was typed: the three ceilings come from
  the modules that enforce them, and the plan totals beside them come from the catalog. So this
  file recomputes each boundary from the constant rather than from a number written here, which
  is what makes it fail when a ceiling moves and the calculator does not.

  It also holds the two rules the surface must not break -- the checkmark belongs to one state,
  and a comparison on this page names no competitor and quotes no price that is not ours.
*/

const client = readFileSync(
  fileURLToPath(new URL("../components/pricing-page-client.tsx", import.meta.url)),
  "utf8",
);
const row = (fit: ReturnType<typeof corpusFit>, id: string) => {
  const found = fit.rows.find((entry) => entry.id === id);
  expect(found, `no row is keyed ${id}`).toBeTruthy();
  return found!;
};

describe("the corpus fit comparator", () => {
  it("reads the page ceiling from the module that enforces it, on both sides of it", () => {
    const at = corpusFit(1, PROCESSING_CEILING.maxSourcePages);
    const over = corpusFit(1, PROCESSING_CEILING.maxSourcePages + 1);
    expect(row(at, "pages-per-source").state).toBe("within");
    expect(row(over, "pages-per-source").state).toBe("refused");
    expect(row(at, "pages-per-source").ceiling).toContain(String(PROCESSING_CEILING.maxSourcePages));
  });

  it("splits a run at the compile part size and refuses it at the corpus ceiling", () => {
    expect(row(corpusFit(COMPILE_MAX_DOCUMENTS, 1), "sources-per-run").state).toBe("within");
    expect(row(corpusFit(COMPILE_MAX_DOCUMENTS + 1, 1), "sources-per-run").state).toBe("split");
    expect(row(corpusFit(CORPUS_MAX_DOCUMENTS, 1), "sources-per-run").state).toBe("split");
    expect(row(corpusFit(CORPUS_MAX_DOCUMENTS + 1, 1), "sources-per-run").state).toBe("refused");
    expect(corpusFit(COMPILE_MAX_DOCUMENTS * 3, 1).parts).toBe(3);
    expect(corpusFit(COMPILE_MAX_DOCUMENTS * 3 + 1, 1).parts).toBe(4);
  });

  /* Volume is billed, never refused. A month that costs more is not a month that failed. */
  it("never refuses a corpus for its monthly volume", () => {
    for (const sources of [1, 40, CORPUS_MAX_DOCUMENTS]) {
      expect(row(corpusFit(sources, PROCESSING_CEILING.maxSourcePages), "pages-in-the-month").state)
        .toBe("within");
    }
  });

  it("derives the volume from the shape, inside the range a quote is given over", () => {
    expect(corpusFit(25, 20).pages).toBe(500);
    expect(corpusFit(CORPUS_MAX_DOCUMENTS * 2, PROCESSING_CEILING.maxSourcePages * 2).pages)
      .toBe(MAX_QUOTED_PAGES);
  });

  /* A spinner hands a component an empty string, a float and a NaN; none of those is a corpus. */
  it("clamps what a number control can actually produce", () => {
    expect(corpusFit(Number.NaN, Number.NaN).pages).toBe(1);
    expect(corpusFit(0, 0).sources).toBe(1);
    expect(corpusFit(3.7, 9.9).pages).toBe(27);
  });

  it("opens on the plan's included pages, so the calculator starts on a covered corpus", () => {
    const opening = client.match(/useState<number>\((\d+)\)[\s\S]{0,200}?useState<number>\((\d+)\)/);
    expect(opening, "the two controls no longer open on a literal pair").toBeTruthy();
    expect(Number(opening![1]) * Number(opening![2]))
      .toBe(BILLING_OFFERS.observer_access.includedPages);
  });
});

describe("what the comparator may not say", () => {
  /* #89's rule, restated for this table: a near-tick is a tick to everyone who reads quickly. */
  it("gives the checkmark to one state and names the state, not the glyph", () => {
    const states: LimitState[] = ["within", "split", "refused"];
    const ticked = states.filter((state) => LIMIT_STATE_GLYPH[state] === "✓");
    expect(ticked).toEqual(["within"]);
    for (const state of states) {
      expect(LIMIT_STATE_LABEL[state].length).toBeGreaterThan(8);
      expect(Object.values(LIMIT_STATE_GLYPH)).not.toContain(LIMIT_STATE_LABEL[state]);
    }
    /* The glyph is decoration over the label; a screen reader is given the label. */
    expect(client).toContain('<span aria-hidden="true">{LIMIT_STATE_GLYPH[row.state]}</span>');
    expect(client).toContain("<small>{LIMIT_STATE_LABEL[row.state]}</small>");
  });

  it("compares our plans against our ceilings and nobody else's price", () => {
    const prose = client.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ");
    for (const competitor of ["Reducto", "LlamaParse", "LlamaIndex", "Unstructured", "Mistral", "Ragie", "Glean", "Contextual AI"]) {
      expect(prose, `the pricing page names ${competitor}`).not.toContain(competitor);
    }
    /*
      The one literal money figure the page may hold is the free plan's zero, which is a label
      rather than a rate. Every other figure on it is computed from the catalog, so a second
      typed price -- ours or anybody's -- fails here.
    */
    expect(prose.match(/\$\d[\d,.]*/g) ?? []).toEqual(["$0"]);
    /* The comparator itself quotes no money at all: it reports ceilings, and ceilings are free. */
    for (const entry of corpusFit(40, 200).rows) {
      expect(`${entry.label}${entry.value}${entry.ceiling}`).not.toContain("$");
    }
  });

  it("claims no accuracy and no throughput anywhere in the comparator", () => {
    const fit = corpusFit(25, 20);
    const words = [...fit.rows.flatMap((entry) => [entry.label, entry.value, entry.ceiling]),
      ...Object.values(LIMIT_STATE_LABEL)].join(" ").toLowerCase();
    for (const barred of ["accuracy", "accurate", "per minute", "per second", "throughput", "at scale", "unlimited"]) {
      expect(words, `the comparator says ${barred}`).not.toContain(barred);
    }
  });
});
