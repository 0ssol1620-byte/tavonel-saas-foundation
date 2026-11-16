import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { RecordCard } from "@/components/v34/ui/record-card";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import { AREAS, ART, CANON, FINAL, SOURCE } from "./creators-content";
import s from "./creators.module.css";

const ordinal = (index: number) => String(index + 1).padStart(2, "0");
const record = v34Route("creators");

/** The route's own drawing: one canon line with four marks, and two drafts that branch off and stay open. */
function CanonArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label={ART.label} preserveAspectRatio="xMidYMid meet">
      <path className={s.canonLine} d="M40 190H600" />
      <path className={s.draft} d="M230 190C260 190 270 90 320 90H480" />
      <path className={s.draft} d="M410 190C430 190 440 262 480 262H560" />
      <circle className={s.open} cx="490" cy="90" r="9" />
      <circle className={s.open} cx="570" cy="262" r="9" />
      <circle className={s.node} cx="90" cy="190" r="12" />
      <circle className={s.node} cx="230" cy="190" r="12" />
      <circle className={s.node} cx="410" cy="190" r="12" />
      <circle className={s.node} cx="570" cy="190" r="17" />
    </svg>
  );
}

export function CreatorsBody() {
  return (
    <>
      <RouteJsonLd route="creators" />
      <Hero
        variant="sub"
        eyebrow={record.ogLabel}
        title={record.title.replace(/ — TAVONEL$/, "")}
        lead={record.description}
        actions={<ButtonLink href={v34Route("studio").path} tone="primary">Open the reference walkthrough</ButtonLink>}
      />

      <Section surface="paper" title={ART.title} lead={ART.lead}>
        <div className={s.stage}>
          <Figure art={<CanonArt />} caption={ART.caption} />
          <ol className={s.steps} aria-label="What a writer checks">
            {ART.steps.map((step, i) => (
              <li key={step.name} className={s.step}>
                <span className={s.stepNo}>{ordinal(i)}</span>
                <p className={s.stepName}>{step.name}</p>
                <p className={s.stepKind}>{step.kind}</p>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <Section surface="green" title={CANON.title}>
        <div className={s.pair}>
          {CANON.items.map((item) => (
            <div key={item.title}>
              <h3 className={s.factTitle}>{item.title}</h3>
              <p className={s.factText}>{item.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section surface="light" title={AREAS.title} lead={AREAS.lead}>
        <ul className={s.facts}>
          {AREAS.items.map((item) => (
            <li key={item.title} className={s.fact}>
              <h3 className={s.factTitle}>{item.title}</h3>
              <p className={s.factText}>{item.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section surface="paper" title={SOURCE.title} lead={SOURCE.lead}>
        <div className={s.sourceWrap}>
          <RecordCard kind={SOURCE.kind} label={SOURCE.label} source={SOURCE.link}>
            <p>{SOURCE.detail}</p>
          </RecordCard>
        </div>
      </Section>

      <FinalCta title={FINAL.title} secondary={FINAL.secondary} />
    </>
  );
}

export default function Creators() {
  return (
    <V34Page route="creators">
      <CreatorsBody />
    </V34Page>
  );
}
