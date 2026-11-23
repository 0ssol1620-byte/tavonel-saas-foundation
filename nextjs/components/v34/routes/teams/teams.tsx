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
import { ACCESS, FINAL, HERO, JOURNAL, PURPOSE } from "./teams-content";
import { TeamsArt } from "./teams-art";
import s from "./teams.module.css";


/** The page body, without the V34 frame, so it can be rendered on its own. */
export function TeamsBody() {
  const route = v34Route("teams");
  const action = createWorldAction();
  return (
    <>
      <RouteJsonLd route="teams" />

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
        art={<Figure art={<TeamsArt />} caption={HERO.caption} />}
      />

      <Section surface="paper" eyebrow={PURPOSE.eyebrow} title={PURPOSE.title} lead={PURPOSE.lead}>
        <ul className={s.points}>
          {PURPOSE.items.map((item) => (
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

export default function Teams() {
  return (
    <V34Page route="teams">
      <TeamsBody />
    </V34Page>
  );
}
