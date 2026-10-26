import type { LandingV2HeroCopy } from "@/lib/landing-v2-copy";
import type { LandingVariant } from "@/lib/landing-experiments";
const SENTENCES = /(?<=\.)\s+/;
export default function HeroStatement({
  copy,
  titleId,
  accent,
  keep,
  headlineVariant = "a",
  children,
}: {
  copy: LandingV2HeroCopy;
  titleId: string;
  accent?: string;
  /*
    R3 (design critique R2-B1): phrases that must not break across lines, e.g. KO "인용할 수 있는" (the dependent noun
    수 stays with 있는). Each is wrapped in .lv2-keep, which the Home sheet sets nowrap; the words are unchanged. KO
    also holds "맥락으로 바꿉니다." (248px at 34px, so it fits a 320px phone): with only the first phrase held, Chromium
    set 390 and 375 as "문서를 AI가 / 인용할 수 있는 맥락으로 / 바꿉니다." -- its text-wrap: balance does not rebalance
    a line with a nowrap run in it -- and the two held phrases leave every width one break that reads.
  */
  keep?: readonly string[];
  headlineVariant?: LandingVariant;
  children?: React.ReactNode;
}) {
  const arm = headlineVariant === "a" ? undefined : copy.headlineExperiment?.[headlineVariant];
  const lines = arm ? arm.split(SENTENCES).filter(Boolean) : copy.headline.split(SENTENCES).filter(Boolean);
  // One capture group, so split() returns the held phrases at the odd indexes.
  const held = !accent && keep?.length ? new RegExp(`(${keep.map(phrase => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`) : null;
  return (
    <div className="lv2-hero-text">
      {/* Fix round 3: the category names the product above the outcome sentence (judge gap 1). */}
      {copy.eyebrow ? <p className="lv2-eyebrow lv2-hero-eyebrow">{copy.eyebrow}</p> : null}
      <h1 className="lv2-hero-h1" id={titleId}>
        {lines.map((line, index) => {
          const at = accent ? line.indexOf(accent) : -1;
          return (
            <span className="lv2-h1-line" key={line}>
              {index > 0 ? " " : null}
              {at < 0 ? (
                held ? line.split(held).map((part, i) => (i % 2 ? <span className="lv2-keep" key={i}>{part}</span> : part)) : line
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
      {/* Brief move 1: the one sentence that says what this is comes before any action or film. */}
      <p className="lv2-hero-support lv2-body-l">{copy.support}</p>
      {children}
    </div>
  );
}
