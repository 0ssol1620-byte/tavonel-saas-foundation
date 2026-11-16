import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import { ART, FINAL, HERO_ACTIONS, LAYERS, SOURCES, UNCERTAINTY } from "./realestate-content";
import s from "./realestate.module.css";

const ordinal = (index: number) => String(index + 1).padStart(2, "0");
const record = v34Route("realestate");

/** The route's own drawing: a parcel grid crossed by three roads, with one parcel outlined. */
function ParcelArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label={ART.label} preserveAspectRatio="xMidYMid meet">
      <path className={s.road} d="M0 70L640 170M190 0L225 320M440 0L400 320" />
      <path className={s.lot} d="M30 100L165 125L175 290L30 262Z M255 28L415 52L404 120L246 92Z M463 28L620 28L620 138L456 110Z M452 200L610 224L596 300L432 290Z" />
      <path className={s.parcel} d="M252 148L405 174L392 296L252 276Z" />
    </svg>
  );
}

/** The route's own drawing: four layers stacked over one region, the parcel layer on top. */
function LayersArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label={LAYERS.art.label} preserveAspectRatio="xMidYMid meet">
      <path className={s.layer} d="M240 234L600 226L600 268L240 276Z" />
      <path className={s.layer} d="M200 172L560 164L560 206L200 214Z" />
      <path className={s.layer} d="M160 110L520 102L520 144L160 152Z" />
      <path className={s.parcel} d="M120 48L480 40L480 82L120 90Z" />
    </svg>
  );
}

export function RealestateBody() {
  return (
    <>
      <RouteJsonLd route="realestate" />
      <Hero
        variant="sub"
        eyebrow={record.ogLabel}
        title={record.heading}
        lead={record.description}
        actions={
          <>
            <ButtonLink href={HERO_ACTIONS.studio.href} tone="primary">{HERO_ACTIONS.studio.label}</ButtonLink>
            <ButtonLink href={HERO_ACTIONS.markets.href} tone="secondary">{HERO_ACTIONS.markets.label}</ButtonLink>
          </>
        }
      />

      <Section surface="paper" title={ART.title} lead={ART.lead}>
        <div className={s.stage}>
          <Figure art={<ParcelArt />} caption={ART.caption} />
          <ol className={s.entries} aria-label="Records that meet at a property">
            {ART.entries.map((entry, i) => (
              <li key={entry.name} className={s.entry}>
                <span className={s.entryNo}>{ordinal(i)}</span>
                <p className={s.entryName}>{entry.name}</p>
                <p className={s.entryDetail}>{entry.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <Section
        surface="light"
        eyebrow={LAYERS.eyebrow}
        title={LAYERS.title}
        lead={LAYERS.lead}
        aside={<Figure art={<LayersArt />} caption={LAYERS.art.caption} />}
      >
        <ul className={s.chips} aria-label="Layers compared">
          {LAYERS.items.map((item) => <li key={item} className={s.chip}>{item}</li>)}
        </ul>
        <ButtonLink href={LAYERS.link.href} tone="secondary">{LAYERS.link.label}</ButtonLink>
      </Section>

      <Section surface="green" title={SOURCES.title}>
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

      <Section surface="paper" title={UNCERTAINTY.title} lead={UNCERTAINTY.lead}>
        <ul className={s.facts}>
          {UNCERTAINTY.items.map((item) => (
            <li key={item.title} className={s.fact}>
              <h3 className={s.factTitle}>{item.title}</h3>
              <p className={s.factText}>{item.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <FinalCta title={FINAL.title} secondary={FINAL.secondary} />
    </>
  );
}

export default function Realestate() {
  return (
    <V34Page route="realestate">
      <RealestateBody />
    </V34Page>
  );
}
