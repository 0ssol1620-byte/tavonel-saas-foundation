import type { Route } from "next";

/*
  /research/program: the research program, which was the whole of /research until that URL became
  the researcher page. The sentences below moved with the page and say what they said.

  Retained pages that are not in the V34 registry (Benchmarks, Reproducibility, Trust, the research
  notes) are linked by path; the one registry route the page links (Evidence) is linked by key.
*/

export const HERO = {
  eyebrow: "Research program",
  title: "The hard parts of turning documents into knowledge.",
  /** Ends where the link to the research notes begins. */
  lede: "Parsing a document is a solved-enough problem. Deciding what the document is about, which of its statements are the same statement as one in another document, what supports them, and what a change to page 40 invalidates three files away — is not. This page is which problems are still open, and how we work on them; the results themselves are on",
} as const;

/** Paths of retained pages that have no registry key. */
export const RETAINED = {
  notes: "/research/notes" as Route,
  benchmarks: "/benchmarks" as Route,
  reproducibility: "/reproducibility" as Route,
  trust: "/trust" as Route,
} as const;

export const AREAS = {
  title: "Research areas",
  items: [
    [
      "Document reading",
      "Recovering text, layout, tables and figures from scans and complex pages, and reporting uncertainty instead of filling it in. The read has to produce coordinates, because everything downstream binds to them.",
    ],
    [
      "Semantic identity",
      "Deciding when two mentions across a corpus are the same thing. Identity is the hard part of compilation: merge too eagerly and the world is wrong, merge too little and it is useless.",
    ],
    [
      "Knowledge construction",
      "Building objects, claims and relations that carry their supporting regions, and refusing to emit the ones that cannot.",
    ],
    [
      "Evidence coverage",
      "Measuring how much of a Compiled World is actually supported by a source region, rather than assuming coverage from the absence of errors.",
    ],
    [
      "Temporal integrity",
      "Keeping worlds versioned as their sources change, so a past answer stays traceable to what the sources said at the time.",
    ],
    [
      "Cost of staying current",
      "Sources keep arriving, and a world nobody can afford to update stops being worth having. What it costs to keep a Compiled World faithful to changing sources is the question this work is aimed at.",
    ],
    [
      "Model independence",
      "The worth of a Compiled World should not rest on which model produced it. Holding the product's guarantees stable while the models underneath change is what this work is for.",
    ],
  ],
} as const;

export const METHOD = {
  title: "How we report",
  items: [
    ["Freeze the configuration", "Model, revision, prompt, schema and price snapshot are pinned before a run, or the result is not comparable to anything."],
    ["Publish the denominator", "A rate without the population it was measured over is not a result. Every number carries what it was measured on."],
    ["Link every number to its receipt", "Every figure links to the receipt it came from, and the receipt holds the complete result the figure was read from."],
    ["Reproduce before comparing", "A competitor's published score is quoted as theirs, never restated as something we reproduced. Comparative claims wait for a same-condition run."],
  ],
} as const;

export const ALSO = {
  title: "Also in the trust case",
  evidenceLabel: "Evidence",
} as const;
