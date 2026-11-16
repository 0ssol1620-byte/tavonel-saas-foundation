import Link from "next/link";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { TrustNext } from "@/components/trust-next";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { CorpusStats } from "@/components/v34/ui/corpus-stats";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { RecordCard } from "@/components/v34/ui/record-card";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { Tag } from "@/components/v34/ui/tag";
import type { EvidencePageView } from "@/lib/evidence-regions";
import { PUBLIC_CORPUS_STATS, readPublicCorpus } from "@/lib/v34/public-corpus";
import type { CorpusSource } from "@/lib/v34/world-geometry";
import { EvidenceArt } from "./evidence-art";
import {
  CONTRACTED, CONTRACTED_LOCATORS, FINAL, HERO, INCOMPLETE, INCOMPLETE_RECORD_ID, MECHANISM, PROVENANCE, PROVENANCE_RECORD_ID,
  PROVENANCE_SOURCE_IDS, REGIONS, TRUST_CASE, VERIFY,
} from "./evidence-content";
import { EvidenceRegions } from "./evidence-regions";
import s from "./evidence.module.css";

const ordinal = (index: number) => String(index + 1).padStart(2, "0");
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function OriginalLink({ source }: { source: CorpusSource }) {
  return (
    <a className={s.sourceLink} href={source[2]} target="_blank" rel="noopener noreferrer" aria-label={`${PROVENANCE.linkLabel}: ${source[0]} (opens in a new tab)`}>
      {PROVENANCE.linkLabel}
    </a>
  );
}

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function EvidenceBody({ view }: { view: EvidencePageView }) {
  const corpus = readPublicCorpus();
  const stats = PUBLIC_CORPUS_STATS(corpus);
  const record = corpus.nodes.find((n) => n.id === PROVENANCE_RECORD_ID);
  const recordSource = record ? corpus.sources[record.source] : undefined;
  const open = corpus.nodes.find((n) => n.id === INCOMPLETE_RECORD_ID);
  const openSource = open ? corpus.sources[open.source] : undefined;
  if (!record || !recordSource || !open || !openSource) throw new Error("evidence: a corpus record the page prints is missing");
  const sources = PROVENANCE_SOURCE_IDS.map((id) => {
    const source = corpus.sources[id];
    if (!source) throw new Error(`evidence: corpus source ${id} is missing`);
    return source;
  });

  return (
    <>
      <Hero
        variant="split"
        eyebrow={HERO.eyebrow}
        title={HERO.title}
        lead={HERO.lead}
        actions={<ButtonLink href={HERO.primary.href}>{HERO.primary.label}</ButtonLink>}
        art={<Figure art={<EvidenceArt label={HERO.art.label} />} caption={HERO.art.caption} />}
      />

      <Section surface="paper" id="regions" title={REGIONS.title} lead={REGIONS.lead}>
        <div className={s.tagRow}>
          <Tag kind="Sample" />
        </div>
        <EvidenceRegions view={view} caption={REGIONS.caption} />
        <div className={s.reading}>
          <p className={s.readingLabel}>{REGIONS.reading.label}</p>
          <p className={s.readingText}>
            <b>{REGIONS.reading.format}</b> · {REGIONS.reading.locator} {REGIONS.reading.text}
          </p>
          <Link className={s.textLink} href={REGIONS.reading.link.href} prefetch={false}>{REGIONS.reading.link.label}</Link>
        </div>
        <div className={s.contracted}>
          <h3 id="contracted-locators" className={s.itemTitle}>{CONTRACTED.title}</h3>
          <p className={s.readingText}>{CONTRACTED.text}</p>
          <ul className={s.locators} aria-labelledby="contracted-locators">
            {CONTRACTED_LOCATORS.map(([family, locator]) => (
              <li key={family} className={s.contractedLocator}>
                <b className={s.locatorFamily}>{family}</b>
                <span>{locator}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section surface="green" eyebrow={MECHANISM.eyebrow} title={MECHANISM.title}>
        <ul className={s.mechanism}>
          {MECHANISM.items.map((item, i) => (
            <li key={item.title} className={s.mechanismItem}>
              <p className={s.kicker}>{ordinal(i)}</p>
              <h3 className={s.itemTitle}>{item.title}</h3>
              <p className={s.itemText}>{item.text}</p>
              {"link" in item ? <a className={s.textLink} href={item.link.href}>{item.link.label}</a> : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section surface="light" eyebrow={PROVENANCE.eyebrow} title={PROVENANCE.title} lead={PROVENANCE.lead}>
        <div className={s.tables}>
          <ScrollTable
            label="Provenance of one record"
            columns={PROVENANCE.recordColumns}
            rows={[
              ["Record", `${record.label} (${record.id})`],
              ["Source", recordSource[0]],
              ["Revision", recordSource[1]],
              ["Locator and pin", recordSource[3]],
              ["Record note", record.note],
            ]}
          />
          <ScrollTable
            label="Sources behind this page"
            columns={PROVENANCE.sourceColumns}
            rows={sources.map((source) => [source[0], source[1], source[3], <OriginalLink key={source[2]} source={source} />])}
          />
        </div>
      </Section>

      <Section
        surface="dark"
        title={INCOMPLETE.title}
        lead={INCOMPLETE.lead}
        aside={
          <RecordCard
            kind={`${open.kind} · ${open.domain}`}
            label={open.label}
            status={sentence(open.status)}
            source={{ href: openSource[2], label: `Open ${openSource[0]}` }}
          >
            <p className={s.cardText}>{open.note}</p>
          </RecordCard>
        }
      >
        <CorpusStats stats={stats.statuses.map((x) => ({ label: `Records marked ${x.status}`, value: x.count }))} />
        <p className={s.incompleteLink}>
          <Link className={s.textLink} href={INCOMPLETE.link.href} prefetch={false}>{INCOMPLETE.link.label}</Link>
        </p>
      </Section>

      <Section surface="paper" eyebrow={VERIFY.eyebrow} title={VERIFY.title}>
        <ol className={s.steps}>
          {VERIFY.steps.map((step, i) => (
            <li key={step.title} className={s.step}>
              <p className={s.kicker}>{ordinal(i)}</p>
              <h3 className={s.itemTitle}>{step.title}</h3>
              <p className={s.itemText}>{step.text}</p>
            </li>
          ))}
        </ol>
        <p className={s.stepsLink}>
          <Link className={s.textLink} href={VERIFY.link.href} prefetch={false}>{VERIFY.link.label}</Link>
        </p>
        <div className={s.trustCase}>
          <p className={s.readingText}>{TRUST_CASE.role}</p>
          <p className={s.readingLabel}>{TRUST_CASE.label}</p>
          <ul className={s.siblings} aria-label={TRUST_CASE.label}>
            {TRUST_CASE.links.map((link) => (
              <li key={link.href}>
                <Link className={s.textLink} href={link.href} prefetch={false}>{link.label}</Link>
              </li>
            ))}
          </ul>
          <TrustNext from="/evidence" emphasis="quiet" />
        </div>
      </Section>

      <FinalCta title={FINAL.title} cta={FINAL.cta} />
    </>
  );
}

export default function Evidence({ view }: { view: EvidencePageView }) {
  return (
    <V34Page route="evidence" surface="paper">
      <RouteJsonLd route="evidence" />
      <EvidenceBody view={view} />
    </V34Page>
  );
}
