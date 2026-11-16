import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { Bridge } from "@/components/v34/ui/bridge";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { CorpusStats } from "@/components/v34/ui/corpus-stats";
import { createWorldAction } from "@/components/v34/ui/create-world";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { Tag } from "@/components/v34/ui/tag";
import { ToolList } from "@/components/v34/ui/tool-list";
import { EXPLORE_SAMPLE_DIGEST, exploreSampleSources } from "@/lib/explore-sample";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import { v34Route } from "@/lib/v34/routes";
import { ACCESS, FINAL, HERO, JOURNAL, SAMPLE, TIME } from "./markets-content";
import { MarketsArt } from "./markets-art";
import s from "./markets.module.css";


/** The page body, without the V34 frame, so it can be rendered on its own. */
export function MarketsBody() {
  const route = v34Route("markets");
  const action = createWorldAction();
  const pages = exploreSampleSources.reduce((sum, source) => sum + source.pageCount, 0);
  return (
    <>
      <RouteJsonLd route="markets" />

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
        art={<Figure art={<MarketsArt />} caption={HERO.caption} />}
      />

      <Section surface="paper" eyebrow={SAMPLE.eyebrow} title={SAMPLE.title} lead={SAMPLE.lead}>
        <div className={s.sampleHead}>
          <Tag kind="Sample" />
          <CorpusStats
            stats={[
              { label: "Filings", value: exploreSampleSources.length },
              { label: "Pages", value: pages },
            ]}
          />
        </div>
        <ScrollTable
          label={SAMPLE.tableLabel}
          columns={SAMPLE.columns}
          rows={exploreSampleSources.map((source) => [
            <a key="l" className={`${s.filingLink} ${s.filing}`} href={source.secUrl} target="_blank" rel="noopener noreferrer">
              {source.sourceLabel}<span className={s.visuallyHidden}> (opens in a new tab)</span>
            </a>,
            source.form,
            source.filingDate,
            source.pageCount,
          ])}
        />
        <p className={s.digest}>{SAMPLE.digestLabel}: <span className={s.digestValue}>{EXPLORE_SAMPLE_DIGEST}</span></p>
        <a className={s.exploreLink} href={EXPLORE_CTA.href}>{EXPLORE_CTA.label} →</a>
      </Section>

      <Section surface="light" eyebrow={TIME.eyebrow} title={TIME.title} lead={TIME.lead}>
        <ul className={s.points}>
          {TIME.items.map((item) => (
            <li key={item.title} className={s.point}>
              <h3 className={s.title}>{item.title}</h3>
              <p className={s.text}>{item.text}</p>
            </li>
          ))}
        </ul>
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

export default function Markets() {
  return (
    <V34Page route="markets">
      <MarketsBody />
    </V34Page>
  );
}
