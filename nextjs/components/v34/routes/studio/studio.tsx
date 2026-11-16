import Link from "next/link";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { CorpusStats } from "@/components/v34/ui/corpus-stats";
import { createWorldAction } from "@/components/v34/ui/create-world";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { RecordCard } from "@/components/v34/ui/record-card";
import { Section } from "@/components/v34/ui/section";
import { Tag } from "@/components/v34/ui/tag";
import { PUBLIC_CORPUS_STATS, readPublicCorpus } from "@/lib/v34/public-corpus";
import { v34Route } from "@/lib/v34/routes";
import { FINAL, HERO, NEXT, SAMPLE, STEPS } from "./studio-content";
import s from "./studio.module.css";

const SUFFIX = / — TAVONEL$/;

/** "01", "02", ... counted from the list position. */
const ordinal = (index: number) => String(index + 1).padStart(2, "0");

/** A source file, the region read from it, and the answer that cites the region. */
function SourceToAnswer() {
  return (
    <svg className={s.art} viewBox="0 0 400 200" role="img" aria-label={HERO.figure}>
      <rect className={s.page} x="28" y="30" width="96" height="140" rx="6" />
      <line className={s.rule} x1="44" y1="56" x2="108" y2="56" />
      <line className={s.rule} x1="44" y1="72" x2="108" y2="72" />
      <rect className={s.region} x="40" y="86" width="72" height="26" rx="3" />
      <line className={s.rule} x1="44" y1="130" x2="96" y2="130" />
      <line className={s.rule} x1="44" y1="146" x2="108" y2="146" />
      <path className={s.link} d="M112 99 H176" />
      <circle className={s.node} cx="188" cy="99" r="10" />
      <path className={s.link} d="M198 99 H252" />
      <rect className={s.answer} x="252" y="62" width="120" height="74" rx="6" />
      <line className={s.rule} x1="268" y1="86" x2="356" y2="86" />
      <line className={s.rule} x1="268" y1="104" x2="340" y2="104" />
      <path className={s.cite} d="M268 124 H300" />
    </svg>
  );
}

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function StudioBody() {
  const record = v34Route("studio");
  const stats = PUBLIC_CORPUS_STATS(readPublicCorpus());
  const action = createWorldAction();
  return (
    <>
      <Hero
        variant="split"
        eyebrow={record.ogLabel}
        title={record.title.replace(SUFFIX, "")}
        lead={record.description}
        actions={<ButtonLink href={action.href} tone="primary" analytics="hero-primary">{action.label}</ButtonLink>}
        art={<Figure art={<SourceToAnswer />} caption={HERO.figure} />}
      />

      <Section surface="paper" eyebrow={STEPS.eyebrow} title={STEPS.title} lead={STEPS.lead}>
        <div className={s.tag}><Tag kind="Reference walkthrough" /></div>
        <ol className={s.steps}>
          {STEPS.items.map((step, i) => (
            <li key={step.label} className={s.step}>
              <div className={s.copy}>
                <p className={s.kicker}>{ordinal(i)} / {step.label}</p>
                <h3 className={s.heading}>{step.heading}</h3>
                <p className={s.body}>{step.body}</p>
                {step.action ? <ButtonLink href={step.action.href} tone="secondary">{step.action.label}</ButtonLink> : null}
              </div>
              {step.record ? (
                <RecordCard
                  as="h4"
                  kind={step.record.kind}
                  label={step.record.title}
                >
                  <p className={s.meta}>{step.record.meta}</p>
                  <p className={s.recordSource}>
                    <a className={s.recordLink} href={step.record.url} target="_blank" rel="noopener noreferrer">
                      {step.record.linkLabel}<span className={s.visuallyHidden}> (opens in a new tab)</span>
                    </a>
                  </p>
                </RecordCard>
              ) : step.purpose ? (
                <RecordCard as="h4" kind={step.purpose.kind} label={step.purpose.label} />
              ) : null}
            </li>
          ))}
        </ol>
      </Section>

      <Section surface="green" eyebrow={SAMPLE.eyebrow} title={SAMPLE.title} lead={SAMPLE.lead}>
        <div className={s.sample}>
          <Tag kind="Public reference corpus" />
          <CorpusStats
            stats={[
              { label: SAMPLE.stats.records, value: stats.records },
              { label: SAMPLE.stats.relations, value: stats.relations },
              { label: SAMPLE.stats.sources, value: stats.sources.total },
            ]}
          />
          <Link className={s.textLink} href={SAMPLE.link.href} prefetch={false}>{SAMPLE.link.label}</Link>
        </div>
      </Section>

      <Section surface="light" eyebrow={NEXT.eyebrow} title={NEXT.title}>
        <ul className={s.next}>
          {NEXT.items.map((item) => (
            <li key={item.href} className={s.nextItem}>
              <Link className={s.nextLink} href={item.href} prefetch={false}>
                <span className={s.nextTitle}>{item.title} <span aria-hidden="true">→</span></span>
                <span className={s.nextText}>{item.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <FinalCta title={FINAL.title} />
    </>
  );
}

export default function Studio() {
  return (
    <V34Page route="studio" surface="paper">
      <RouteJsonLd route="studio" />
      <StudioBody />
    </V34Page>
  );
}
