import type { LandingV2HeroCopy } from "@/lib/landing-v2-copy";
import type { LandingVariant } from "@/lib/landing-experiments";
const SENTENCES = /(?<=\.)\s+/;
export default function HeroStatement({
  copy,
  titleId,
  accent,
  headlineVariant = "a",
}: {
  copy: LandingV2HeroCopy;
  titleId: string;
  accent?: string;
  headlineVariant?: LandingVariant;
}) {
  const arm = headlineVariant === "a" ? undefined : copy.headlineExperiment?.[headlineVariant];
  const lines = arm ? arm.split(SENTENCES).filter(Boolean) : copy.headline.split(SENTENCES).filter(Boolean);
  return (
    <div className="lv2-hero-text">
      <p className="lv2-eyebrow lv2-meta">{copy.eyebrow}</p>
      <h1 className="lv2-hero-h1" id={titleId}>
        {lines.map((line, index) => {
          const at = accent ? line.indexOf(accent) : -1;
          return (
            <span className="lv2-h1-line" key={line}>
              {index > 0 ? " " : null}
              {at < 0 ? (
                line
              ) : (
                <>
                  {line.slice(0, at)}
                  <em className="lv2-emphasis">{accent}</em>
                  {line.slice(at + accent!.length)}
                </>
              )}
            </span>
          );
        })}
      </h1>
      <p className="lv2-hero-support lv2-body-l">{copy.support}</p>
    </div>
  );
}
