import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import { AUTONOMY, BRIEFING, FINAL, HERO_ACTIONS, REVIEW } from "./autopilot-content";
import s from "./autopilot.module.css";

const ordinal = (index: number) => String(index + 1).padStart(2, "0");
const record = v34Route("autopilot");

/** The route's own drawing: two revisions feed one proposal, a gate stands before the World. */
function ProposalArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label={REVIEW.art.label} preserveAspectRatio="xMidYMid meet">
      <rect className={s.box} x="30" y="60" width="130" height="64" rx="8" />
      <rect className={s.box} x="30" y="196" width="130" height="64" rx="8" />
      <path className={s.flow} d="M160 92H230L250 150M160 228H230L250 170" />
      <rect className={s.faint} x="250" y="110" width="150" height="100" rx="10" />
      <rect className={s.box} x="250" y="110" width="150" height="100" rx="10" />
      <path className={s.box} d="M274 140H376M274 160H350M274 180H364" />
      <path className={s.flow} d="M400 160H470" />
      <path className={s.gate} d="M490 70V250" />
      <circle className={s.dot} cx="490" cy="160" r="10" />
      <path className={s.flow} d="M510 160H560" />
      <circle className={s.box} cx="590" cy="160" r="30" />
    </svg>
  );
}

export function AutopilotBody() {
  return (
    <>
      <RouteJsonLd route="autopilot" />
      <Hero
        variant="sub"
        eyebrow={record.ogLabel}
        title={record.title.replace(/ — TAVONEL$/, "")}
        lead={record.description}
        actions={
          <>
            <ButtonLink href={HERO_ACTIONS.connect.href} tone="primary">{HERO_ACTIONS.connect.label}</ButtonLink>
            <ButtonLink href={HERO_ACTIONS.changes.href} tone="secondary">{HERO_ACTIONS.changes.label}</ButtonLink>
          </>
        }
      />

      <Section surface="paper" title={BRIEFING.title} lead={BRIEFING.lead}>
        <ol className={s.timeline} aria-label="Items in a briefing">
          {BRIEFING.steps.map((step, i) => (
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
        eyebrow={REVIEW.eyebrow}
        title={REVIEW.title}
        aside={<Figure art={<ProposalArt />} caption={REVIEW.art.caption} />}
      >
        <div className={s.layers}>
          {REVIEW.items.map((item) => (
            <div key={item.title} className={s.layer}>
              <h3 className={s.factTitle}>{item.title}</h3>
              <p className={s.factText}>{item.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section surface="light" title={AUTONOMY.title}>
        <ol className={s.facts}>
          {AUTONOMY.steps.map((step, i) => (
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

export default function Autopilot() {
  return (
    <V34Page route="autopilot">
      <AutopilotBody />
    </V34Page>
  );
}
