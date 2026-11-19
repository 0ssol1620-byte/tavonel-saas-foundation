import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { Bridge } from "@/components/v34/ui/bridge";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { CorpusStats } from "@/components/v34/ui/corpus-stats";
import { createWorldAction } from "@/components/v34/ui/create-world";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { RecordCard } from "@/components/v34/ui/record-card";
import { Section } from "@/components/v34/ui/section";
import { Tag } from "@/components/v34/ui/tag";
import { ToolList } from "@/components/v34/ui/tool-list";
import { PUBLIC_CORPUS_STATS, readPublicCorpus } from "@/lib/v34/public-corpus";
import { v34Route } from "@/lib/v34/routes";
import { ACCESS, FINAL, HERO, JOURNAL, REFERENCE, STEPS, SUPPORT } from "./engineering-content";
import { EngineeringArt } from "./engineering-art";
import s from "./engineering.module.css";

const ordinal = (index: number) => String(index + 1).padStart(2, "0");
const DOMAIN = "Standards";

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function EngineeringBody() {
  const route = v34Route("engineering");
  const action = createWorldAction();
  const corpus = readPublicCorpus();
  const standards = corpus.nodes.filter((n) => n.domain === DOMAIN);
  const changes = standards.filter((n) => n.kind === REFERENCE.recordKind);
  return (
    <>
      <RouteJsonLd route="engineering" />

      <Hero
        variant="split"
        eyebrow={HERO.eyebrow}
        title={route.heading}
        lead={route.description}
        actions={
          <div className={s.actions}>
            <ButtonLink href={action.href} tone="onDark">{action.label}</ButtonLink>
            <ButtonLink href={HERO.secondary.href} tone="secondary">{HERO.secondary.label}</ButtonLink>
          </div>
        }
        art={<Figure art={<EngineeringArt />} caption={HERO.caption} />}
      />

      <Section
        surface="paper"
        eyebrow={SUPPORT.eyebrow}
        title={SUPPORT.title}
        lead={SUPPORT.lead}
        aside={
          <div className={s.issue}>
            <Tag kind="Illustration" />
            <p className={s.issueTitle}>{SUPPORT.card.title}</p>
            <dl className={s.issueRows}>
              {SUPPORT.card.rows.map(([term, text]) => (
                <div key={term} className={s.issueRow}>
                  <dt className={s.issueTerm}>{term}</dt>
                  <dd className={s.issueText}>{text}</dd>
                </div>
              ))}
            </dl>
          </div>
        }
      />

      <Section surface="green" eyebrow={STEPS.eyebrow} title={STEPS.title}>
        <ol className={s.steps}>
          {STEPS.items.map((item, i) => (
            <li key={item.title} className={s.step}>
              <span className={s.no}>{ordinal(i)}</span>
              <h3 className={s.title}>{item.title}</h3>
              <p className={s.text}>{item.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section surface="paper" eyebrow={REFERENCE.eyebrow} title={REFERENCE.title} lead={REFERENCE.lead}>
        <div className={s.refHead}>
          <Tag kind="Public reference corpus" />
          <CorpusStats
            stats={[
              { label: REFERENCE.statsControls, value: PUBLIC_CORPUS_STATS(corpus).controlRecords },
              { label: REFERENCE.statsSources, value: standards.filter((n) => n.kind === "Source").length },
            ]}
          />
        </div>
        <ul className={s.records}>
          {changes.map((node) => {
            const source = corpus.sources[node.source];
            return (
              <li key={node.id} className={s.record}>
                <RecordCard
                  kind={node.kind}
                  label={node.label}
                  status={node.status}
                >
                  <p className={s.text}>{node.note}</p>
                  {source ? (
                    <a className={s.sourceLink} href={source[2]} target="_blank" rel="noopener noreferrer">
                      {REFERENCE.sourceLabel}: {source[0]}<span className={s.visuallyHidden}> (opens in a new tab)</span>
                    </a>
                  ) : null}
                </RecordCard>
              </li>
            );
          })}
        </ul>
        <div className={s.refActions}>
          <ButtonLink href={REFERENCE.changes.href} tone="primary">{REFERENCE.changes.label}</ButtonLink>
          <ButtonLink href={REFERENCE.security.href} tone="secondary">{REFERENCE.security.label}</ButtonLink>
        </div>
      </Section>

      <Section surface="connect" eyebrow={ACCESS.eyebrow} title={ACCESS.title} lead={ACCESS.lead}>
        <div className={s.tools}><ToolList /></div>
        <div className={s.accessActions}>
          <ButtonLink href={ACCESS.primary.href} tone="onDark">{ACCESS.primary.label}</ButtonLink>
          <ButtonLink href={ACCESS.secondary.href} tone="secondary">{ACCESS.secondary.label}</ButtonLink>
        </div>
      </Section>

      <Bridge eyebrow={JOURNAL.eyebrow} title={JOURNAL.title} text={JOURNAL.text} href={JOURNAL.href} label={JOURNAL.label} />

      <FinalCta title={FINAL.title} />
    </>
  );
}

export default function Engineering() {
  return (
    <V34Page route="engineering">
      <EngineeringBody />
    </V34Page>
  );
}
