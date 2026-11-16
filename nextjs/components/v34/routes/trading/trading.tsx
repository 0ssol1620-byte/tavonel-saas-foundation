import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import { ART, FINAL, HERO_ACTIONS, LAYERS, REPLAY, SOURCES } from "./trading-content";
import s from "./trading.module.css";

const ordinal = (index: number) => String(index + 1).padStart(2, "0");
const record = v34Route("trading");

/** The route's own drawing: a price line, three dated events, and a cutoff with the later revision shaded past it. */
function CutoffArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label={LAYERS.art.label} preserveAspectRatio="xMidYMid meet">
      <path className={s.grid} d="M0 80H640M0 160H640M0 240H640M160 0V320M320 0V320M480 0V320" />
      <rect className={s.later} x="500" y="0" width="140" height="320" />
      <path className={s.event} d="M140 190V300M300 120V300M440 150V300" />
      <path className={s.price} d="M20 230L70 220L110 240L150 190L190 200L240 160L280 175L320 130L360 145L400 105L440 150L490 95L540 110L620 70" />
      <circle className={s.mark} cx="140" cy="190" r="9" />
      <circle className={s.mark} cx="300" cy="120" r="9" />
      <circle className={s.mark} cx="440" cy="150" r="9" />
      <path className={s.cutoff} d="M500 20V300" />
    </svg>
  );
}

export function TradingBody() {
  return (
    <>
      <RouteJsonLd route="trading" />
      <Hero
        variant="sub"
        eyebrow={record.ogLabel}
        title={record.heading}
        lead={record.description}
        actions={
          <>
            <ButtonLink href={HERO_ACTIONS.connect.href} tone="primary">{HERO_ACTIONS.connect.label}</ButtonLink>
            <ButtonLink href={HERO_ACTIONS.markets.href} tone="secondary">{HERO_ACTIONS.markets.label}</ButtonLink>
          </>
        }
      />

      <Section surface="paper" title={ART.title} lead={ART.lead}>
        <ol className={s.timeline} aria-label="Four dates of a research replay">
          {ART.steps.map((step, i) => (
            <li key={step.name} className={s.step}>
              <span className={s.stepNo}>{ordinal(i)}</span>
              <p className={s.stepName}>{step.name}</p>
              <p className={s.stepKind}>{step.kind}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        surface="dark"
        eyebrow={LAYERS.eyebrow}
        title={LAYERS.title}
        aside={<Figure art={<CutoffArt />} caption={LAYERS.art.caption} />}
      >
        <div className={s.layers}>
          {LAYERS.items.map((item) => (
            <div key={item.title} className={s.layer}>
              <h3 className={s.factTitle}>{item.title}</h3>
              <p className={s.factText}>{item.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section surface="light" title={SOURCES.title} lead={SOURCES.lead}>
        <ul className={s.sources}>
          {SOURCES.items.map((item) => (
            <li key={item.label} className={s.source}>
              <h3 className={s.sourceName}>{item.label}</h3>
              <p className={s.sourceText}>{item.text}</p>
              <a className={s.sourceLink} href={item.href} aria-label={`${SOURCES.linkLabel}: ${item.label}`}>
                {SOURCES.linkLabel}<span aria-hidden="true"> →</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section surface="green" title={REPLAY.title}>
        <ol className={s.facts}>
          {REPLAY.steps.map((step, i) => (
            <li key={step.title} className={s.fact}>
              <span className={s.factNo}>{ordinal(i)}</span>
              <h3 className={s.factTitle}>{step.title}</h3>
              <p className={s.factText}>{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <FinalCta title={FINAL.title} secondary={FINAL.secondary} />
    </>
  );
}

export default function Trading() {
  return (
    <V34Page route="trading">
      <TradingBody />
    </V34Page>
  );
}
