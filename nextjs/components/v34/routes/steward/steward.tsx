import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import { FINAL, HERO_ACTIONS, INBOX, MAINTENANCE, QUEUE } from "./steward-content";
import s from "./steward.module.css";

const ordinal = (index: number) => String(index + 1).padStart(2, "0");
const record = v34Route("steward");

/** The route's own drawing: three review rows, the first open, a hold mark beside the second. */
function QueueArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label={INBOX.art.label} preserveAspectRatio="xMidYMid meet">
      <rect className={s.open} x="60" y="40" width="520" height="110" rx="10" />
      <circle className={s.dot} cx="96" cy="70" r="9" />
      <path className={s.text} d="M128 70H300M96 104H480M96 128H400" />
      <rect className={s.box} x="60" y="170" width="520" height="52" rx="10" />
      <path className={s.text} d="M96 196H300" />
      <path className={s.hold} d="M520 184V208M540 184V208" />
      <rect className={s.box} x="60" y="242" width="520" height="52" rx="10" />
      <path className={s.text} d="M96 268H260" />
    </svg>
  );
}

export function StewardBody() {
  return (
    <>
      <RouteJsonLd route="steward" />
      <Hero
        variant="sub"
        eyebrow={record.ogLabel}
        title={record.heading}
        lead={record.description}
        actions={
          <>
            <ButtonLink href={HERO_ACTIONS.evidence.href} tone="primary">{HERO_ACTIONS.evidence.label}</ButtonLink>
            <ButtonLink href={HERO_ACTIONS.changes.href} tone="secondary">{HERO_ACTIONS.changes.label}</ButtonLink>
          </>
        }
      />

      <Section surface="paper" title={QUEUE.title} lead={QUEUE.lead}>
        <ol className={s.timeline} aria-label="Items in a review queue">
          {QUEUE.steps.map((step, i) => (
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
        eyebrow={INBOX.eyebrow}
        title={INBOX.title}
        lead={INBOX.lead}
        aside={<Figure art={<QueueArt />} caption={INBOX.art.caption} />}
      >
        <div className={s.layers}>
          {INBOX.items.map((item) => (
            <div key={item.title} className={s.layer}>
              <h3 className={s.factTitle}>{item.title}</h3>
              <p className={s.factText}>{item.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section surface="green" title={MAINTENANCE.title}>
        <ol className={s.facts}>
          {MAINTENANCE.steps.map((step, i) => (
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

export default function Steward() {
  return (
    <V34Page route="steward">
      <StewardBody />
    </V34Page>
  );
}
