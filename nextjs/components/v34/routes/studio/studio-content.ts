import type { Route } from "next";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";
import { WALKTHROUGH_STEPS } from "@/lib/v34/walkthrough";

/*
  The words of the studio page that are not computed. The page title and lead are the registry's;
  the four middle steps take their heading, body and source record from lib/v34/walkthrough.ts (the
  same NIST SP 800-53 facts the home walkthrough shows), and the counts come from the corpus
  snapshot at render time. There is no number in this file: ordinals are counted from the list
  position.
*/

/** A destination is a registry key, resolved here; the page test fails if it names a held route. */
const to = (key: V34RouteKey): Route => v34Route(key).path;

export const HERO = {
  figure: "A source file, the region read from it and the answer that cites that region.",
} as const;

type WalkthroughRecord = (typeof WALKTHROUGH_STEPS)[number]["record"];

export interface StudioStep {
  readonly label: string;
  readonly heading: string;
  readonly body: string;
  /** A source record from the reference walkthrough. */
  readonly record?: WalkthroughRecord;
  /** The first step names a purpose instead of a source. */
  readonly purpose?: { readonly kind: string; readonly label: string };
  /** The last step points at the page that connects an AI. */
  readonly action?: { readonly href: Route; readonly label: string };
}

const [connect, compile, current, answer] = WALKTHROUGH_STEPS;

const ITEMS: readonly StudioStep[] = [
  {
    label: "Choose",
    heading: "Name what the World is for.",
    body: "A World starts with a question, so every source added to it has a reason to be there.",
    purpose: { kind: "Purpose", label: "Follow how the NIST control catalogue changes between releases." },
  },
  { label: "Add a source", heading: connect!.heading, body: connect!.body, record: connect!.record },
  { label: "Compile", heading: compile!.heading, body: compile!.body, record: compile!.record },
  { label: "Keep current", heading: current!.heading, body: current!.body, record: current!.record },
  { label: "Ask", heading: answer!.heading, body: answer!.body, record: answer!.record },
  {
    label: "Connect your AI",
    heading: "Bring the World to the AI you use.",
    body: "Point an MCP-compatible client at the World, so it reads the same records you see.",
    action: { href: to("connect"), label: "Connect your AI" },
  },
];

export const STEPS = {
  eyebrow: "Reference walkthrough",
  title: "From a source to a cited answer, step by step.",
  lead: "One public source, followed through every stage of a World. The records are fixed, so every visit shows the same walkthrough.",
  items: ITEMS,
} as const;

export const SAMPLE = {
  eyebrow: "What the sample holds",
  title: "Every figure counted from the public reference corpus.",
  lead: "The walkthrough runs over a fixed public corpus, so you can check each record it cites.",
  link: { href: to("world"), label: "Inspect the World →" },
  stats: { records: "Records", relations: "Relationships", sources: "Public sources" },
} as const;

export const NEXT = {
  eyebrow: "After the first answer",
  title: "Your World grows with you.",
  items: [
    { href: to("connect"), title: "Connect your AI", text: "Set up a client that reads the World." },
    { href: to("evidence"), title: "Trace a claim", text: "Review its source and its uncertainty." },
    { href: to("changes"), title: "Review a change", text: "Compare an earlier and a later release of a source." },
    { href: to("compiler"), title: "Follow the compiler", text: "See how a source becomes records." },
  ],
} as const;

export const FINAL = { title: "Create your first World." } as const;

/** Every route the page links to, for the guard test. */
export const STUDIO_DESTINATIONS: readonly Route[] = [
  SAMPLE.link.href,
  ...STEPS.items.flatMap((i) => (i.action ? [i.action.href] : [])),
  ...NEXT.items.map((i) => i.href),
];
