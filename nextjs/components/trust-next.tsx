import Link from "next/link";
import type { Route } from "next";

/*
  The trust funnel, declared once so the five pages cannot disagree about their own order.

  Security, Evidence, Benchmarks, Reproducibility and Research each ended with three sibling
  links to two or three of the others, in a different order on every page. A reader who wanted
  to work through the trust case had to guess which of the three was the next step, and two of
  the five -- /reproducibility and /research -- had no way onward at all, so the sequence simply
  stopped. That is five microsites, not a funnel (§17).

  This is the §17 order with the §22 rule applied to it: each entry carries the customer question
  the *next* page answers and the precise action that gets there, never "Learn more". The chain
  ends at /pricing rather than looping, because §6 puts "understand price" after "trust
  security / evidence / benchmarks" and a reader who has read all five has finished the trust
  case and is being asked a different question.

  It is data rather than five hand-written blocks for the reason the site navigation is data:
  the previous version of this was hand-written on each page and had already drifted.
*/
export const TRUST_SEQUENCE = [
  { href: "/security", label: "Security", question: "Where do my documents go?" },
  { href: "/evidence", label: "Evidence", question: "Can I verify a compiled fact?" },
  { href: "/benchmarks", label: "Benchmarks", question: "Does the architecture have merit?" },
  { href: "/reproducibility", label: "Reproducibility", question: "Can I rebuild it myself?" },
  { href: "/research/program", label: "Research", question: "What is still open?" },
  { href: "/pricing", label: "Pricing", question: "What does this cost?" },
] as const;

export type TrustStep = (typeof TRUST_SEQUENCE)[number]["href"];

/**
 * The precise action that moves a reader from one step to the next. Never a generic CTA.
 *
 * BA-096: "Rebuild the measurement" was a promise /reproducibility does not keep. What that page
 * publishes is three digest-bound public sample PDFs and two downloadable manifests -- byte
 * identity, which is a real thing to offer and is not a measurement to rebuild. A CTA whose
 * destination contradicts it costs more than a plainer one, so the label names what the page
 * actually hands over.
 */
const NEXT_ACTION: Record<TrustStep, string> = {
  "/security": "See how evidence is bound",
  "/evidence": "See what was measured",
  "/benchmarks": "Rerun the public sample",
  "/reproducibility": "Read the open questions",
  "/research/program": "Read what was measured",
  "/pricing": "See the plans",
};

/*
  G2-043. The one step whose next page is not the page after it in the order.

  /research ended on /pricing, so a reader who had just been shown seven unsolved problems was
  asked to buy. The page that answers what /research raises is /research/notes -- the two
  measurements, the hypothesis that failed, the thresholds nobody has calibrated -- and it was
  reachable only from a small inline link in the lede.

  It is an override rather than a sixth entry in TRUST_SEQUENCE because the sequence is the §17
  order of the five hub pages, and notes is a leaf of one of them rather than a sixth hub. The
  chain still ends at /pricing: the notes page offers it as its closing ghost.
*/
const INSTEAD_OF_THE_NEXT_STEP: Partial<Record<TrustStep, { to: Route; label: string; question: string }>> = {
  "/research/program": {
    to: "/research/notes" as Route,
    label: "Research notes",
    question: "What has actually been measured?",
  },
};

/*
  Lead decision 17 (WO-CI-24): the heading takes the role its position has.

  A V34 trust page renders this block inside one of its Sections, under that Section's own H2, so
  the block's heading is a sub-heading of that Section: an H3, whose size the host's sheet maps to
  the V34 sub-heading size (`--t-6`). As an H2 it sat beside the Section's H2 at a second size
  (/evidence: 33.84px against 61.92px at 1440). A retained page places the block beside its own
  H2s, so there it stays an H2. Only the host knows where it puts the block, so the host names the
  level (`heading`, required): there is no default for a host to fall into, and a value that is
  neither level is refused rather than rendered.
*/
const HEADING_LEVELS = ["h2", "h3"] as const;
type TrustNextHeading = (typeof HEADING_LEVELS)[number];

/**
 * The one next step at the foot of a trust page.
 *
 * `from` is the page rendering it, so a page never has to know its own position in the order.
 *
 * BA-097: `emphasis`. /evidence renders its own filled CTA -- "Open a result at its exact source
 * location", the proof the page has just spent a screen promising -- and then this component
 * rendered a second filled button 200px below it, so one view had two primaries competing. The
 * host page's own action is the better primary, so a page that already has one passes
 * `emphasis="quiet"` and this step renders as a ghost. The step is not removed: the sequence
 * exists because /reproducibility and /research had no way onward at all.
 */
export function TrustNext({ from, heading, emphasis = "primary" }: {
  from: TrustStep;
  heading: TrustNextHeading;
  emphasis?: "primary" | "quiet";
}) {
  if (!HEADING_LEVELS.includes(heading)) {
    throw new Error(`TrustNext from ${from}: heading must be one of ${HEADING_LEVELS.join(", ")}, got ${String(heading)}`);
  }
  const index = TRUST_SEQUENCE.findIndex((step) => step.href === from);
  const override = INSTEAD_OF_THE_NEXT_STEP[from];
  const next = override ? { href: override.to, label: override.label, question: override.question } : TRUST_SEQUENCE[index + 1];
  if (!next) return null;
  const Heading = heading;
  return (
    <div className="stack trust-next">
      <Heading>Next: {next.label}</Heading>
      <p className="fine">{next.question}</p>
      <div className="actions">
        <Link className={emphasis === "quiet" ? "btn ghost" : "btn"} href={next.href as Route}>
          {NEXT_ACTION[from]}
        </Link>
      </div>
    </div>
  );
}
