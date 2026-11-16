import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { CorpusStats } from "@/components/v34/ui/corpus-stats";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { Tag } from "@/components/v34/ui/tag";
import { WorldInstrument } from "@/components/v34/world/world-instrument";
import { PUBLIC_CORPUS_STATS, readPublicCorpus } from "@/lib/v34/public-corpus";
import { v34Route } from "@/lib/v34/routes";
import { CATALOG_LABEL, DOMAINS, FINAL, HERO, INSTRUMENT, NEXT, SOURCES } from "./world-content";
import s from "./world.module.css";

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function WorldBody() {
  const corpus = readPublicCorpus();
  const stats = PUBLIC_CORPUS_STATS(corpus);
  const loaded = Object.values(corpus.sources).filter((source) => source[1] !== CATALOG_LABEL);
  return (
    <>
      <Hero variant="sub" eyebrow={HERO.eyebrow} title={v34Route("world").heading} lead={HERO.lead} />

      <Section surface="green">
        <WorldInstrument variant="full" />
        <p className={s.instrumentNote}>{INSTRUMENT.note}</p>
      </Section>

      <Section surface="paper" eyebrow={DOMAINS.eyebrow} title={DOMAINS.title} lead={DOMAINS.lead}>
        <div className={s.stats}>
          <Tag kind="Public reference corpus" />
          <CorpusStats stats={stats.domains.map((d) => ({ label: d.domain, value: d.count }))} />
        </div>
      </Section>

      <Section surface="light" title={SOURCES.title} lead={SOURCES.lead}>
        <ScrollTable
          label="Public sources cited by the reference World"
          columns={SOURCES.columns}
          rows={loaded.map(([label, revision, url, note]) => [
            label,
            revision,
            note,
            <a key={url} className={s.sourceLink} href={url} target="_blank" rel="noopener noreferrer" aria-label={`${SOURCES.linkLabel}: ${label} (opens in a new tab)`}>
              {SOURCES.linkLabel}
            </a>,
          ])}
        />
        <p className={s.tableNote}>
          {loaded.length.toLocaleString("en-US")} of {stats.sources.total.toLocaleString("en-US")} sources
          are documents the records were read from. The other {stats.sources.referenceOnly.toLocaleString("en-US")} are
          catalog entries that name a public data publisher.
        </p>
      </Section>

      <Section surface="paper" eyebrow={NEXT.eyebrow} title={NEXT.title} lead={NEXT.lead}>
        <div className={s.actions}>
          <ButtonLink href={NEXT.primary.href}>{NEXT.primary.label}</ButtonLink>
          <ButtonLink href={NEXT.secondary.href} tone="secondary">{NEXT.secondary.label}</ButtonLink>
        </div>
      </Section>

      <FinalCta title={FINAL.title} cta={FINAL.cta} />
    </>
  );
}

export default function World() {
  return (
    <V34Page route="world" surface="paper">
      <RouteJsonLd route="world" />
      <WorldBody />
    </V34Page>
  );
}
