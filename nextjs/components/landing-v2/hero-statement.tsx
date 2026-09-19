import HeroActions from "./hero-actions";
import type { LandingV2HeroCopy } from "@/lib/landing-v2-copy";

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
  actions,
}: {
  copy: LandingV2HeroCopy;
  titleId: string;
  accent?: string;
  actions: {
    exploreLabel: string;
    exploreHref: string;
    accessLabel: string;
    accessHref: string;
    workspaceLabel: string;
    scene: string;
  };
}) {
  // One sentence per line. The outcome, then the proof -- §11.1's own two-line composition.
  const lines = copy.headline.split(/(?<=\.)\s+/).filter(Boolean);
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
        {copy.microProofFormats} · {copy.microProofConnected}
      </p>
    </div>
  );
}
