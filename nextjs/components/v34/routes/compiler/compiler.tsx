import Link from "next/link";
import type { Route } from "next";
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
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { surfaceClass } from "@/components/v34/ui/surface";
import { Tag } from "@/components/v34/ui/tag";
import { CompilerArt } from "./compiler-art";
import { BRIDGE, FINAL, FORMATS, HERO, REGION, SOURCES, STAGES } from "./compiler-content";
import s from "./compiler.module.css";

/** "01", "02", ... counted from the list position. */
const ordinal = (index: number) => String(index + 1).padStart(2, "0");

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function CompilerBody() {
  const action = createWorldAction();
  return (
    <>
      <Hero
        variant="split"
        eyebrow={HERO.eyebrow}
        title={HERO.title}
        lead={HERO.lead}
        actions={
          <>
            <ButtonLink href={action.href} tone="primary">{action.label}</ButtonLink>
            <ButtonLink href={HERO.secondary.href} tone="secondary">{HERO.secondary.label}</ButtonLink>
          </>
        }
        art={<Figure art={<CompilerArt />} caption={HERO.figure} />}
      />

      <Section surface="light" eyebrow={FORMATS.eyebrow} title={FORMATS.title} lead={FORMATS.lead}>
        <div className={s.stats}>
          <CorpusStats stats={FORMATS.stats} />
        </div>
        <ScrollTable label={FORMATS.label} caption={FORMATS.caption} columns={FORMATS.columns} rows={FORMATS.rows} />
        <p className={s.after}>
          <Link className={s.textLink} href={FORMATS.link.href} prefetch={false}>{FORMATS.link.label}</Link>
        </p>
      </Section>

      <Section surface="green" eyebrow={STAGES.eyebrow} title={STAGES.title} lead={STAGES.lead}>
        <ol className={s.stages}>
          {STAGES.items.map((item, index) => (
            <li key={item.title} className={s.stage}>
              <p className={s.stageKicker}>{ordinal(index)}</p>
              <h3 className={s.stageTitle}>{item.title}</h3>
              <p className={s.stageText}>{item.text}</p>
              {"link" in item ? <a className={s.textLink} href={item.link.href}>{item.link.label}</a> : null}
            </li>
          ))}
        </ol>
      </Section>

      <Section
        surface="dark"
        title={REGION.title}
        lead={REGION.lead}
        aside={
          <div className={`${surfaceClass("nestedLight")} ${s.receipt}`}>
            <dl className={s.fields} aria-label={REGION.label}>
              {REGION.items.map((item) => (
                <div key={item.term} className={s.field}>
                  <dt className={s.term}>{item.term}</dt>
                  <dd className={s.definition}>{item.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        }
      >
        <Link className={s.textLink} href={REGION.link.href} prefetch={false}>{REGION.link.label}</Link>
      </Section>

      <Section surface="paper" eyebrow={SOURCES.eyebrow} title={SOURCES.title} lead={SOURCES.lead}>
        <div className={s.tag}>
          <Tag kind="Public reference corpus" />
        </div>
        <ul className={s.sources}>
          {SOURCES.items.map((item) => (
            <li key={item.href} className={s.source}>
              <RecordCard kind="Source" label={item.name} status={item.edition} source={{ href: item.href, label: "Open the publisher's page" }} />
            </li>
          ))}
        </ul>
        <p className={s.after}>{SOURCES.more.text}</p>
        <ul className={`${s.sources} ${s.references}`}>
          {SOURCES.references.map((item) => (
            <li key={item.href} className={s.source}>
              <RecordCard kind="Reference" label={item.name} source={{ href: item.href, label: "Open the publisher's page" }}>
                {item.about}
              </RecordCard>
            </li>
          ))}
        </ul>
        <p className={s.after}>
          <Link className={s.textLink} href={SOURCES.more.link.href as Route} prefetch={false}>{SOURCES.more.link.label}</Link>
        </p>
      </Section>

      <Bridge title={BRIDGE.title} text={BRIDGE.text} href={BRIDGE.href} label={BRIDGE.label} />

      <FinalCta title={FINAL.title} cta={FINAL.cta} />
    </>
  );
}

export default function Compiler() {
  return (
    <V34Page route="compiler">
      <RouteJsonLd route="compiler" />
      <CompilerBody />
    </V34Page>
  );
}
