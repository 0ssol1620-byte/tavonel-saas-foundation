import HeroActions from "./hero-actions";
import type { LandingV2HeroCopy } from "@/lib/landing-v2-copy";
import type { LandingVariant } from "@/lib/landing-experiments";

/** One sentence per line: §11.1's two-line composition, split at the sentence break. */
const SENTENCES = /(?<=\.)\s+/;

/*
  The hero's text column (blueprint §10.1, §32): eyebrow, headline, support, actions, intake line.

  THE EDITORIAL ACCENT
  D3 allows Instrument Serif in exactly two places on this landing, and one of them is a phrase
  of the H1. The phrase is "every source", for the reason the whole page exists: "AI-ready
  knowledge" is the outcome every product in this category promises, and "traceable to every
  source" is the half only this one is built to prove. It is also the last thing read, and the
  noun the §4.1 signature interaction, the Evidence scene and the source label under the hero
  demo all point back to. Setting the verb instead would accent the mechanism over the thing.

  The headline is never retyped. It is split out of `BRAND_LINE.headline` at render time, so the
  accent is a rendering of the founder-owned constant rather than a second copy of it, and a
  headline that no longer contains the phrase renders whole instead of breaking.

  The Korean H1 carries no serif. Instrument Serif has no Hangul, and a synthetic oblique of a
  fallback face is not an editorial accent -- it is a browser guessing. The Korean headline's own
  two-sentence break does the work instead.
*/
export default function HeroStatement({
  copy,
  titleId,
  /** The phrase set in the editorial serif, or undefined where the face cannot set the script. */
  accent,
  /*
    D8 Test 01's arm. "a" -- and no prop at all -- is `BRAND_LINE.headline`, which is what every
    deployment renders while no experiment is active.

    On arm B or C the H1 IS the arm, and the brand line is printed nowhere on the page. The
    alternative D8 allows -- demoting it to a support eyebrow -- would put two answers to "what
    is this" one line apart and measure a headline against itself; an experiment on the headline
    has to replace the headline. The eyebrow keeps its own words, which name the category rather
    than make the claim.

    The serif accent is arm A's alone, and needs no condition: `accent` is a phrase of the brand
    line, neither experiment arm contains it, and a phrase that is not found renders the line
    whole. An arm with no accent is the honest rendering of a headline that has no such phrase.
  */
  headlineVariant = "a",
  actions,
}: {
  copy: LandingV2HeroCopy;
  titleId: string;
  accent?: string;
  headlineVariant?: LandingVariant;
  actions: {
    exploreLabel: string;
    exploreHref: string;
    accessLabel: string;
    accessHref: string;
    workspaceLabel: string;
    scene: string;
    /** D8 Test 02's arm, applied by `HeroActions` to which control is the filled one. */
    ctaOrderVariant?: LandingVariant;
  };
}) {
  /*
    The headline is never retyped here, on any arm: arm A splits the founder-owned constant the
    copy deck imported, and arms B and C split the deck's own experiment strings. An arm the deck
    does not carry falls back to the default rather than rendering an empty heading.
  */
  const arm = headlineVariant === "a" ? undefined : copy.headlineExperiment?.[headlineVariant];
  const lines = arm ? arm.split(SENTENCES).filter(Boolean) : copy.headline.split(SENTENCES).filter(Boolean);
  return (
    <div className="lv2-hero-text">
      <p className="lv2-eyebrow lv2-meta">{copy.eyebrow}</p>
      <h1 className="lv2-hero-h1" id={titleId}>
        {lines.map((line) => {
          const at = accent ? line.indexOf(accent) : -1;
          return (
            <span className="lv2-h1-line" key={line}>
              {at < 0 ? (
                line
              ) : (
                <>
                  {line.slice(0, at)}
                  <em className="lv2-serif">{accent}</em>
                  {line.slice(at + accent!.length)}
                </>
              )}
            </span>
          );
        })}
      </h1>
      <p className="lv2-hero-support lv2-body-l">{copy.support}</p>
      <HeroActions {...actions} />
      {/*
        The intake line is derived, not typed (§10.1). `describeAcceptedFormats` is the sentence
        /sources and /docs already publish, so a format the upload route refuses cannot appear
        here, and the connector path is named beside it rather than inside the format list.
      */}
      <p className="lv2-hero-intake lv2-meta">
        {copy.microProofFormats}{" "}
        {/*
          D10: the run wraps at its own commas and nowhere else. The format sentence's commas are
          the break points a reader expects; the clause after the middot is one phrase, and a
          break inside it left a stray separator hanging at the end of a line.
        */}
        <span className="lv2-hero-intake-tail">· {copy.microProofConnected}</span>
      </p>
    </div>
  );
}
