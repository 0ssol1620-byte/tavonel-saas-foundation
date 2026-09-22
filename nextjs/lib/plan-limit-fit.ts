import { COMPILE_MAX_DOCUMENTS, CORPUS_MAX_DOCUMENTS } from "./compile-limits";
import { MAX_QUOTED_PAGES } from "./usage-pricing";
import { PROCESSING_CEILING } from "../../shared/intakeCeiling";

/*
  Gap #5 (V-5). The plan-times-limit half of the pricing calculator.

  The estimator above it answers "what does this corpus cost". It never answered the question a
  buyer asks first, which is whether the corpus can be compiled here at all -- and the answer to
  that is not on the plan. Every ceiling in this deployment is a property of the reading chain,
  not of the subscription: `PROCESSING_CEILING` is what the CDR accepts, `CORPUS_MAX_DOCUMENTS`
  and `COMPILE_MAX_DOCUMENTS` are the corpus contract, and none of the four published plans moves
  any of them. So the comparator states that outcome rather than dressing it up as a difference:
  a row lands in the same state for every plan, and the plan totals beside it are the only column
  that moves.

  Three states, not a tick and a dash, for the reason `/pricing`'s capability table has three: a
  corpus of forty sources is neither accepted whole nor refused -- it is compiled in parts, each
  part its own World reviewed on its own, and a checkmark there would promise one World. Only
  `within` earns the tick.

  Nothing here is typed. The three ceilings are imported from the modules that enforce them, so a
  ceiling change moves this calculator and `plan-limit-fit.test.ts` fails if a row stops reading
  the constant it reports.
*/

export type LimitState = "within" | "split" | "refused";

export type LimitFitRow = {
  id: "pages-per-source" | "sources-per-run" | "pages-in-the-month";
  label: string;
  state: LimitState;
  /** What this corpus asks for. */
  value: string;
  /** The ceiling it is measured against, or the absence of one. */
  ceiling: string;
};

export type CorpusFit = {
  sources: number;
  pagesPerSource: number;
  /** Sources times pages, which is what the money estimate is quoted over. */
  pages: number;
  /** How many compile runs the corpus contract splits this selection into. */
  parts: number;
  rows: LimitFitRow[];
};

/** A whole number inside a range: a spinner can hand this an empty string, a float or a NaN. */
function clampInteger(value: number, low: number, high: number) {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, Math.floor(value)));
}

const n = (value: number) => value.toLocaleString("en-US");

/**
 * The fit of one corpus against the three ceilings a compile is measured by.
 *
 * `sources` and `pagesPerSource` are read from the two controls; both are clamped rather than
 * validated, because the surface is a calculator and a refusal there teaches nobody anything.
 * `MAX_QUOTED_PAGES` bounds the product so the money estimate stays inside the range
 * `quoteCompilePages` will quote at all.
 */
export function corpusFit(sources: number, pagesPerSource: number): CorpusFit {
  const safeSources = clampInteger(sources, 1, CORPUS_MAX_DOCUMENTS * 2);
  const safePages = clampInteger(pagesPerSource, 1, PROCESSING_CEILING.maxSourcePages * 2);
  const pages = Math.min(MAX_QUOTED_PAGES, safeSources * safePages);
  const parts = Math.ceil(safeSources / COMPILE_MAX_DOCUMENTS);

  const rows: LimitFitRow[] = [
    {
      id: "pages-per-source",
      label: "Pages in one source",
      state: safePages > PROCESSING_CEILING.maxSourcePages ? "refused" : "within",
      value: n(safePages),
      ceiling: `${n(PROCESSING_CEILING.maxSourcePages)} per source, on every plan`,
    },
    {
      id: "sources-per-run",
      label: "Sources in one run",
      state: safeSources > CORPUS_MAX_DOCUMENTS
        ? "refused"
        : safeSources > COMPILE_MAX_DOCUMENTS
          ? "split"
          : "within",
      value: safeSources > CORPUS_MAX_DOCUMENTS
        ? n(safeSources)
        : `${n(safeSources)} in ${n(parts)} ${parts === 1 ? "part" : "parts"}`,
      ceiling: `${n(CORPUS_MAX_DOCUMENTS)} per run, compiled in parts of ${n(COMPILE_MAX_DOCUMENTS)}`,
    },
    {
      id: "pages-in-the-month",
      label: "Pages in the month",
      /* Volume past a plan's included pages is billed, never refused: the row is always within. */
      state: "within",
      value: n(pages),
      ceiling: "Billed past the plan's included pages, at the published rate",
    },
  ];

  return { sources: safeSources, pagesPerSource: safePages, pages, parts, rows };
}

/** The glyph a state earns. Only `within` gets the checkmark; the others are not near-ticks. */
export const LIMIT_STATE_GLYPH: Record<LimitState, string> = {
  within: "✓",
  split: "▨",
  refused: "—",
};

/** The accessible name of a state is the state, never the glyph read aloud. */
export const LIMIT_STATE_LABEL: Record<LimitState, string> = {
  within: "Within the ceiling",
  split: "Compiled in parts",
  refused: "Refused before processing",
};
