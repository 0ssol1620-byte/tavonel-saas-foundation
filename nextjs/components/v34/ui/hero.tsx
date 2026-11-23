import type { ReactNode } from "react";
import { surfaceClass, type V34Surface } from "./surface";
import { Eyebrow, Lead } from "./text";
import s from "./hero.module.css";

export type HeroVariant = "home" | "sub" | "split";

const DEFAULT_SURFACE: Record<HeroVariant, V34Surface> = { home: "heroHome", sub: "paper", split: "green" };

/** The id the page's single h1 carries. A page renders exactly one Hero; the shell renders no h1. */
export const HERO_TITLE_ID = "v34-title";

/**
 * The page opening. `title` is the page's one h1. `art` is the right column of the home and split
 * variants; it takes a figure, the World instrument or a screen and is allowed to shrink
 * (`min-width: 0`), so a wide child cannot push the page past the viewport. `foot` is a strip under
 * both columns (the home variant's layer index).
 */
export function Hero({ variant, surface, eyebrow, title, lead, actions, art, foot }: {
  variant: HeroVariant;
  surface?: V34Surface;
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  art?: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <section className={`${surfaceClass(surface ?? DEFAULT_SURFACE[variant])} ${s.hero} ${s[variant]}`} aria-labelledby={HERO_TITLE_ID}>
      <div className={s.shell}>
        <div className={s.copy}>
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h1 id={HERO_TITLE_ID} className={s.title}>{title}</h1>
          {lead ? <div className={s.lead}><Lead>{lead}</Lead></div> : null}
          {actions ? <div className={s.actions}>{actions}</div> : null}
        </div>
        {art ? <div className={s.art}>{art}</div> : null}
      </div>
      {foot ? <div className={s.foot}>{foot}</div> : null}
    </section>
  );
}
