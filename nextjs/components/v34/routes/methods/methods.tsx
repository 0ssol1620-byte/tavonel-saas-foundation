import Link from "next/link";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { createWorldAction } from "@/components/v34/ui/create-world";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { MethodsArt } from "./methods-art";
import { FINAL, HERO, OUTCOMES, STAGES, SURFACE } from "./methods-content";
import s from "./methods.module.css";

/** "01", "02", ... counted from the list position. */
const ordinal = (index: number) => String(index + 1).padStart(2, "0");

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function MethodsBody() {
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
        art={<Figure art={<MethodsArt />} caption={HERO.figure} />}
      />

      <Section surface="paper" eyebrow={STAGES.eyebrow} title={STAGES.title} lead={STAGES.lead}>
        <ol className={s.stages}>
          {STAGES.items.map((item, index) => (
            <li key={item.title} className={s.stage}>
              <p className={s.kicker}>{ordinal(index)}</p>
              <p className={s.flow}>
                <span>{item.input}</span>
                <span aria-hidden="true"> → </span>
                <strong className={s.output}>{item.output}</strong>
              </p>
              <h3 className={s.stageTitle}>{item.title}</h3>
              <p className={s.stageText}>{item.text}</p>
              <p className={s.check}><span className={s.checkLabel}>Check</span> {item.check}</p>
              <Link className={s.textLink} href={item.link.href} prefetch={false}>{item.link.label}</Link>
            </li>
          ))}
        </ol>
      </Section>

      <Section surface="dark" title={SURFACE.title} lead={SURFACE.lead}>
        <ol className={s.phases} aria-label="Kinds of work">
          {SURFACE.phases.map((phase) => (
            <li key={phase.name} className={s.phase}>
              <strong className={s.phaseName}>{phase.name}</strong>
              <span className={s.phaseDetail}>{phase.detail}</span>
            </li>
          ))}
        </ol>
        <ul className={s.items}>
          {SURFACE.items.map((item) => (
            <li key={item.title} className={s.item}>
              <h3 className={s.itemTitle}>{item.title}</h3>
              <p className={s.itemText}>{item.text}</p>
            </li>
          ))}
        </ul>
        <div className={s.action}>
          <ButtonLink href={SURFACE.link.href} tone="onDark">{SURFACE.link.label}</ButtonLink>
        </div>
      </Section>

      <Section surface="light" eyebrow={OUTCOMES.eyebrow} title={OUTCOMES.title} lead={OUTCOMES.lead}>
        <ul className={s.outcomes}>
          {OUTCOMES.items.map((item) => (
            <li key={item.kicker} className={s.outcome}>
              <p className={s.kicker}>{item.kicker}</p>
              <h3 className={s.stageTitle}>{item.title}</h3>
              <p className={s.stageText}>{item.text}</p>
              <Link className={s.textLink} href={item.link.href} prefetch={false}>{item.link.label}</Link>
            </li>
          ))}
        </ul>
      </Section>

      <FinalCta title={FINAL.title} secondary={FINAL.secondary} />
    </>
  );
}

export default function Methods() {
  return (
    <V34Page route="methods">
      <RouteJsonLd route="methods" />
      <MethodsBody />
    </V34Page>
  );
}
