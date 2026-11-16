import Link from "next/link";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { Bridge } from "@/components/v34/ui/bridge";
import { createWorldAction } from "@/components/v34/ui/create-world";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { RecordCard } from "@/components/v34/ui/record-card";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { Tag } from "@/components/v34/ui/tag";
import { PUBLIC_CORPUS_STATS, readPublicCorpus } from "@/lib/v34/public-corpus";
import { v34Route } from "@/lib/v34/routes";
import { BRIDGE, FINAL, HERO, PROGRAM, RECORD, STATES, STEPS, THREAD } from "./research-content";
import { readResearchThread, statusLabel, type ThreadSource } from "./research-data";
import { ResearchArt, ThreadArt } from "./research-art";
import s from "./research.module.css";

const SUFFIX = / — TAVONEL$/;

/*
  The link is written here rather than passed as the card's source: the shared card's link paints
  nothing on hover, and the QA matrix reads that as a missing state. Queued for the shared sheet.
*/
const sourceCard = (src: ThreadSource) => (
  <RecordCard
    key={src.id}
    kind={src.kind}
    label={src.label}
    status={src.catalog ? RECORD.reference : undefined}
  >
    <p className={s.note}>{src.note}</p>
    <a className={s.original} href={src.href} target="_blank" rel="noopener noreferrer">
      {RECORD.open}
      <span className={s.visuallyHidden}> (opens in a new tab)</span>
    </a>
  </RecordCard>
);

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function ResearchBody() {
  const route = v34Route("research");
  const action = createWorldAction();
  const corpus = readPublicCorpus();
  const stats = PUBLIC_CORPUS_STATS(corpus);
  const thread = readResearchThread(corpus);
  const inZone = thread.planets.filter((p) => p.inZone);
  const zoneName = thread.zone.label.toLowerCase();
  return (
    <>
      <Hero
        variant="split"
        eyebrow={HERO.eyebrow}
        title={route.title.replace(SUFFIX, "")}
        lead={route.description}
        actions={
          <>
            <ButtonLink href={action.href} tone="primary">{action.label}</ButtonLink>
            <ButtonLink href={PROGRAM.href} tone="secondary">{PROGRAM.label}</ButtonLink>
          </>
        }
        art={<Figure art={<ResearchArt />} caption={HERO.art} />}
      />

      <Section surface="dark" eyebrow={THREAD.eyebrow} title={THREAD.title} lead={THREAD.lead}>
        <div className={s.thread}>
          <div className={s.threadMain}>
            <h3 className={s.threadHeading}>{thread.planets.length} planets. {inZone.length} in the {zoneName}.</h3>
            <Figure art={<ThreadArt planets={thread.planets} />} caption={THREAD.caption} />
            <p className={s.threadNote}>
              <Tag kind="Public reference corpus" />
              <span>{stats.records.toLocaleString("en-US")} records from {stats.sources.total.toLocaleString("en-US")} public sources</span>
            </p>
          </div>
          <div className={s.sources}>{thread.cited.map(sourceCard)}</div>
        </div>
      </Section>

      <Section surface="light" title={STATES.title} lead={STATES.lead}>
        <ScrollTable
          label={STATES.label}
          columns={STATES.columns}
          rows={[
            [`${thread.planets.length} planets of ${thread.star.label}`, statusLabel(thread.star.status), `Described by ${thread.cited.map((c) => c.label).join(" and ")}.`],
            [`${inZone.length} planets in the ${zoneName}`, statusLabel(inZone[0]?.status ?? ""), `Each has a "located in" relationship to the ${zoneName} record.`],
            [thread.zone.label, statusLabel(thread.zone.status), thread.zone.note],
          ]}
        />
      </Section>

      <Section surface="green" eyebrow={STEPS.eyebrow} title={STEPS.title} lead={STEPS.lead}>
        <ol className={s.steps}>
          {STEPS.items.map((step, i) => (
            <li key={step.key} className={s.step}>
              <p className={s.stepNo}>{String(i + 1).padStart(2, "0")}</p>
              <h3 className={s.stepTitle}>{step.title}</h3>
              <p className={s.stepText}>{step.text}</p>
              <Link className={s.textLink} href={v34Route(step.key).path} prefetch={false}>{step.label}</Link>
            </li>
          ))}
        </ol>
      </Section>

      <Section surface="paper" eyebrow={RECORD.eyebrow} title={RECORD.title} lead={RECORD.lead}>
        <div className={s.others}>{thread.others.map(sourceCard)}</div>
      </Section>

      <Bridge eyebrow={BRIDGE.eyebrow} title={BRIDGE.title} text={BRIDGE.text} href={BRIDGE.href} label={BRIDGE.label} />

      <FinalCta title={FINAL.title} cta={FINAL.cta} secondary={FINAL.secondary} />
    </>
  );
}
