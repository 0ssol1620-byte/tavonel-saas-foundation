import Link from "next/link";
import type { Route } from "next";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { createWorldAction } from "@/components/v34/ui/create-world";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { PlatformArt } from "./platform-art";
import { ATTACHED, CHANGE, CHECKS, FINAL, FORMATS, HERO, LIFECYCLE, YOUR_AI } from "./platform-content";
import s from "./platform.module.css";

/** "01", "02", ... counted from the list position. */
const ordinal = (index: number) => String(index + 1).padStart(2, "0");

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function PlatformBody() {
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
        art={<Figure art={<PlatformArt />} caption={HERO.figure} />}
      />

      <Section surface="paper" eyebrow={LIFECYCLE.eyebrow} title={LIFECYCLE.title} lead={LIFECYCLE.lead}>
        <ol className={s.steps}>
          {LIFECYCLE.steps.map((step, index) => (
            <li key={step.title} className={s.step}>
              <p className={s.stepKicker}>{ordinal(index)} / {step.phase}</p>
              <h3 className={s.stepTitle}>{step.title}</h3>
              <p className={s.stepText}>{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section surface="green" eyebrow={ATTACHED.eyebrow} title={ATTACHED.title} lead={ATTACHED.lead}>
        <ul className={s.facts}>
          {ATTACHED.items.map((item) => (
            <li key={item.title} className={s.fact}>
              <h3 className={s.factTitle}>{item.title}</h3>
              <p className={s.factText}>{item.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section surface="dark" title={YOUR_AI.title}>
        <ul className={s.pair}>
          {YOUR_AI.items.map((item) => (
            <li key={item.title} className={s.pairItem}>
              <h3 className={s.pairTitle}>{item.title}</h3>
              <p className={s.pairText}>{item.text}</p>
              {"link" in item ? (
                <Link className={s.textLink} href={item.link.href} prefetch={false}>{item.link.label}</Link>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section surface="light" eyebrow={CHECKS.eyebrow} title={CHECKS.title} lead={CHECKS.lead}>
        <ScrollTable
          label={CHECKS.label}
          columns={CHECKS.columns}
          rows={CHECKS.rows.map((row) => [
            row.stage,
            row.text,
            "file" in row.look
              ? <a key={row.look.href} className={s.tableLink} href={row.look.href}>{row.look.label}</a>
              : <Link key={row.look.href} className={s.tableLink} href={row.look.href as Route} prefetch={false}>{row.look.label}</Link>,
          ])}
        />
      </Section>

      <Section surface="green" eyebrow={CHANGE.eyebrow} title={CHANGE.title}>
        <ul className={s.pair}>
          {CHANGE.items.map((item) => (
            <li key={item.title} className={s.pairItem}>
              <h3 className={s.pairTitle}>{item.title}</h3>
              <p className={s.pairText}>{item.text}</p>
              {"link" in item ? (
                <Link className={s.textLink} href={item.link.href} prefetch={false}>{item.link.label}</Link>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section surface="paper" eyebrow={FORMATS.eyebrow} title={FORMATS.title} lead={FORMATS.lead}>
        <ScrollTable
          label={FORMATS.label}
          columns={FORMATS.columns}
          rows={FORMATS.rows.map(([format, path]) => [format, <code key={path} className={s.path}>{path}</code>])}
        />
      </Section>

      <FinalCta title={FINAL.title} cta={FINAL.cta} />
    </>
  );
}

export default function Platform() {
  return (
    <V34Page route="platform">
      <RouteJsonLd route="platform" />
      <PlatformBody />
    </V34Page>
  );
}
