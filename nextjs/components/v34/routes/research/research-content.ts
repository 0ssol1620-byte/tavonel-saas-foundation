import type { Route } from "next";
import { TRUST_SEQUENCE } from "@/components/trust-next";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of /research that are not the shared pieces' own, and not the corpus's. The title and
  lead are the registry's; every figure about the TRAPPIST-1 thread is read from the corpus at
  render time (see research-data.ts), so there is no number in this file.

  A destination is a registry key, never a typed path, with one exception: the research program
  page has no registry row yet, so its path is declared here once.
*/

const to = (key: V34RouteKey): Route => v34Route(key).path;

/** The research program page (the former /research body). It has no registry row yet. */
export const PROGRAM = { href: "/research/program" as Route, label: "Read the research program" } as const;

export const HERO = {
  eyebrow: "For researchers",
  art: "A claim traced to the passage that supports it. A dashed line marks a record whose status is uncertain.",
} as const;

export const THREAD = {
  eyebrow: "A worked example",
  title: "TRAPPIST-1: a real research thread.",
  lead: "Follow one published system from its sources to the records built on them.",
  caption: "Schematic of the system's planets in order from the host star at even spacing. Planets the corpus relates to the habitable zone are filled.",
} as const;

export const STATES = {
  title: "Separate observation from interpretation.",
  lead: "Each row is a record in the corpus with its state and the source behind it.",
  columns: ["Record", "State", "Reason"],
  label: "Records of the TRAPPIST-1 thread, with their state and reason",
} as const;

export const STEPS = {
  eyebrow: "From papers to a record you can check",
  title: "Build a record that keeps its sources.",
  lead: "Every study brings a method, a scope and a date. The World keeps them attached to what you read.",
  items: [
    { title: "Compile", text: "Compile your PDFs into a World of records, each with the evidence region it came from.", key: "platform", label: "See the platform →" },
    { title: "Trace", text: "Follow any claim to the exact region of its source document and read the original text.", key: "evidence", label: "Open the evidence →" },
    { title: "Compare", text: "When a source is revised, compare two versions of the World and see which records changed.", key: "changes", label: "See the changes →" },
    { title: "Read", text: "Connect an MCP client and read the World with read-only tools.", key: "connect", label: "Connect a client →" },
  ] satisfies readonly { title: string; text: string; key: V34RouteKey; label: string }[],
} as const;

/*
  The next step after the four: the measured results (WO-CI-24, benchmarks.spec "is reachable from
  research"). /benchmarks is a retained page with no registry row, so its path and its name are the
  trust sequence's own rather than typed here; a sequence without that step stops the build.
  The sentence ends before the link: the link is the block's action and stands in its own row
  (lead decision 23), so it is never a 44 px box inside a line of text.
*/
const benchmarks = TRUST_SEQUENCE.find((step) => step.label === "Benchmarks");
if (!benchmarks) throw new Error("research: the trust sequence has no Benchmarks step to link");
export const MEASURED = {
  text: "How the compiler is measured, and the conditions each result was measured under.",
  href: benchmarks.href as Route,
  label: benchmarks.label,
} as const;

export const RECORD = {
  eyebrow: "More sources in the corpus",
  title: "Follow the record behind the conclusion.",
  lead: "The other science sources the corpus holds, each with its original one click away.",
  open: "Open original →",
  reference: "Reference only",
} as const;

export const BRIDGE = {
  eyebrow: "Field guide",
  title: "Trace a claim back to its method.",
  text: "A worked example that follows each claim about the planets to the source that supports it.",
  href: to("journal-research"),
  label: "Read the research guide",
} as const;

export const FINAL = {
  title: "Inspect the source network.",
  cta: { href: to("world"), label: "Inspect the World" },
  secondary: { href: PROGRAM.href, label: "Read the research program →" },
} as const;

/** Every destination the page links to by registry key, for the release guard. */
export const RESEARCH_DESTINATIONS: readonly Route[] = [
  ...STEPS.items.map((i) => to(i.key)),
  BRIDGE.href,
  FINAL.cta.href as Route,
];
