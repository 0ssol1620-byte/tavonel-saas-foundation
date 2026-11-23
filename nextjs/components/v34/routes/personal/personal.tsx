import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { Bridge } from "@/components/v34/ui/bridge";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { createWorldAction } from "@/components/v34/ui/create-world";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { ToolList } from "@/components/v34/ui/tool-list";
import { v34Route } from "@/lib/v34/routes";
import { ACCESS, FINAL, HERO, HOLDS, JOURNAL, STEPS } from "./personal-content";
import { PersonalArt } from "./personal-art";
import s from "./personal.module.css";

const ordinal = (index: number) => String(index + 1).padStart(2, "0");

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function PersonalBody() {
  const route = v34Route("personal");
  const action = createWorldAction();
  return (
    <>
      <RouteJsonLd route="personal" />

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
        art={<Figure art={<PersonalArt />} caption={HERO.caption} />}
      />

      <Section surface="paper" eyebrow={HOLDS.eyebrow} title={HOLDS.title} lead={HOLDS.lead}>
        <ul className={s.holds}>
          {HOLDS.items.map((item) => (
            <li key={item.title} className={s.hold}>
              <h3 className={s.title}>{item.title}</h3>
              <p className={s.text}>{item.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section surface="light" eyebrow={STEPS.eyebrow} title={STEPS.title}>
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

export default function Personal() {
  return (
    <V34Page route="personal">
      <PersonalBody />
    </V34Page>
  );
}
