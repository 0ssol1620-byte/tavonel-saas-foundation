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
  { href: "/research", label: "Research", question: "What is still open?" },
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
  "/research": "Understand what it costs",
  "/pricing": "Start with your files",
};

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
export function TrustNext({ from, emphasis = "primary" }: { from: TrustStep; emphasis?: "primary" | "quiet" }) {
  const index = TRUST_SEQUENCE.findIndex((step) => step.href === from);
  const next = TRUST_SEQUENCE[index + 1];
  if (!next) return null;
  return (
    <div className="stack trust-next">
      <p className="slate"><span />NEXT · {next.label.toUpperCase()}</p>
      <p className="fine">{next.question}</p>
      <div className="actions">
        <Link className={emphasis === "quiet" ? "btn ghost" : "btn"} href={next.href as Route}>
          {NEXT_ACTION[from]}
        </Link>
      </div>
    </div>
  );
}
