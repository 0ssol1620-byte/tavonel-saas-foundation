import Link from "next/link";
import V34Page from "@/components/v34/shell/v34-page";
import { Bridge } from "@/components/v34/ui/bridge";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { CorpusStats } from "@/components/v34/ui/corpus-stats";
import { createWorldAction } from "@/components/v34/ui/create-world";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { Tag } from "@/components/v34/ui/tag";
import { Walkthrough } from "@/components/v34/walkthrough/walkthrough";
import { WorldInstrument } from "@/components/v34/world/world-instrument";
import { PUBLIC_CORPUS_STATS, readPublicCorpus } from "@/lib/v34/public-corpus";
import {
  CASES, CONNECT, FINAL, HERO, JOURNAL, TRUST, WALKTHROUGH, WALKTHROUGH_ANCHOR,
} from "./home-content";
import HomeAnalytics from "./home-analytics";
import s from "./home.module.css";

/** "01", "02", ... counted from the list position. */
const ordinal = (index: number) => String(index + 1).padStart(2, "0");

/** The World instrument (it carries its own layer legend with a count per kind) and the way into the full page. */
function HeroArt() {
  return (
    <div className={s.worldStack}>
      <WorldInstrument variant="hero" />
      <Link className={s.worldLink} href={HERO.worldLink.href} prefetch={false}>{HERO.worldLink.label}</Link>
    </div>
  );
}

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function HomeBody() {
  const stats = PUBLIC_CORPUS_STATS(readPublicCorpus());
  const action = createWorldAction();
  return (
    <>
      <HomeAnalytics />

      <Hero
        variant="home"
        eyebrow={HERO.eyebrow}
        title={<>{HERO.titleLead}<span className={s.accent}>{HERO.titleAccent}</span></>}
        lead={HERO.lead}
        actions={
          <>
            <ButtonLink href={action.href} tone="onDark" analytics="hero-primary">{action.label}</ButtonLink>
            <a className={s.watch} href={`#${WALKTHROUGH_ANCHOR}`} data-analytics="hero-secondary">{HERO.secondary}</a>
            <p className={s.note}>{HERO.note}</p>
          </>
        }
        art={<HeroArt />}
        foot={
          <ol className={s.layers} aria-label="Record layers, source to change">
            {stats.layers.map((l) => (
              <li key={l.kind}>{String(l.layer).padStart(2, "0")} / {l.kind}</li>
            ))}
          </ol>
        }
      />

      <Section id={WALKTHROUGH_ANCHOR} surface="paper" eyebrow={WALKTHROUGH.eyebrow} title={WALKTHROUGH.title} lead={WALKTHROUGH.lead}>
        <div className={s.demoStats}>
          <Tag kind="Public reference corpus" />
          <CorpusStats
            stats={[
              { label: "Records", value: stats.records },
              { label: "Relationships", value: stats.relations },
              { label: "Public sources", value: stats.sources.total },
            ]}
          />
        </div>
        <Walkthrough />
        <div className={s.demoFoot}>
          <p className={s.footNote}>{WALKTHROUGH.foot}</p>
          <p className={s.footLinks}>
            {WALKTHROUGH.links.map((link) => (
              <Link key={link.href} className={s.textLink} href={link.href} prefetch={false}>{link.label}</Link>
            ))}
          </p>
        </div>
      </Section>

      <Section surface="cases" eyebrow={CASES.eyebrow} title={CASES.title} lead={CASES.lead}>
        <ol className={s.cases}>
          {CASES.items.map((c, i) => (
            <li key={c.href} className={s.caseItem}>
              <Link className={s.caseLink} href={c.href} prefetch={false}>
                <span className={s.caseNo}>{ordinal(i)}</span>
                <div className={s.caseBody}>
                  <span className={s.caseLabel}>{c.label}</span>
                  <h3 className={s.caseTitle}>{c.title}</h3>
                  <span className={s.caseText}>{c.text}</span>
                </div>
                <span className={s.caseTag}>{c.tag}</span>
                <span className={s.caseArrow} aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ol>
        <p className={s.casesAll}>
          <Link className={s.textLink} href={CASES.all.href} prefetch={false}>{CASES.all.label}</Link>
        </p>
      </Section>

      <Section
        surface="connect"
        eyebrow={CONNECT.eyebrow}
        title={CONNECT.title}
        lead={CONNECT.lead}
        aside={
          <div className={s.diagram}>
            <div className={s.origin}>
              <p className={s.originName}>{CONNECT.origin.name}</p>
              <p className={s.originDetail}>{CONNECT.origin.detail}</p>
            </div>
            <ul className={s.hosts}>
              {CONNECT.hosts.map((h) => (
                <li key={h.name} className={s.host}>
                  <p className={s.hostName}>{h.name}</p>
                  <p className={s.hostDetail}>{h.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        }
      >
        <div className={s.connectActions}>
          <ButtonLink href={CONNECT.primary.href} tone="onDark">{CONNECT.primary.label}</ButtonLink>
          <ButtonLink href={CONNECT.secondary.href} tone="secondary">{CONNECT.secondary.label}</ButtonLink>
        </div>
      </Section>

      <Section surface="paper" eyebrow={TRUST.eyebrow} title={TRUST.title} lead={TRUST.lead}>
        <ul className={s.trust}>
          {TRUST.items.map((t, i) => (
            <li key={t.href} className={s.trustItem}>
              <p className={s.trustKicker}>{ordinal(i)} / {t.kicker}</p>
              <h3 className={s.trustTitle}>{t.title}</h3>
              <p className={s.trustText}>{t.text}</p>
              <Link className={s.textLink} href={t.href} prefetch={false}>{t.label}</Link>
            </li>
          ))}
        </ul>
      </Section>

      <Bridge eyebrow={JOURNAL.eyebrow} title={JOURNAL.title} href={JOURNAL.href} label={JOURNAL.label} />

      <FinalCta title={FINAL.title} eyebrow={FINAL.eyebrow} secondary={FINAL.secondary} tone="final" />
    </>
  );
}

export default function Home() {
  return (
    <V34Page route="home" surface="paper">
      <HomeBody />
    </V34Page>
  );
}
