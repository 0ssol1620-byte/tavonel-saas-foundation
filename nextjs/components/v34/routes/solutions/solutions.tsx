import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { Bridge } from "@/components/v34/ui/bridge";
import { createWorldAction } from "@/components/v34/ui/create-world";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { surfaceClass } from "@/components/v34/ui/surface";
import { SOLUTIONS } from "@/app/solutions/[slug]/page";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import { v34Route } from "@/lib/v34/routes";
import { BRIDGE, FIELDS, FINAL, HERO, ROLES, TASKS, type SolutionLink } from "./solutions-content";
import { SolutionsArt } from "./solutions-art";
import s from "./solutions.module.css";


/**
 * One card, one link. The anchor's ::after covers the card (a stretched link), so the whole card is
 * the target and there is a single tab stop; `data-v34-card` declares the card the QA harness may
 * let that cover sit over its own text.
 */
function Card({ kicker, title, href, children }: { kicker: string; title: string; href: Route; children: ReactNode }) {
  return (
    <li className={s.item}>
      <article className={`${surfaceClass("light")} ${s.card}`} data-v34-card="">
        <p className={s.kicker}>{kicker}</p>
        <h3 className={s.title}>
          <Link className={s.link} href={href} prefetch={false}>
            {title}
            <span className={s.arrow} aria-hidden="true"> →</span>
          </Link>
        </h3>
        {children}
      </article>
    </li>
  );
}

function PathCards({ items }: { items: readonly SolutionLink[] }) {
  return (
    <ul className={s.pairs}>
      {items.map((item) => (
        <Card key={item.key} kicker={item.kicker} title={item.title} href={item.href}>
          <p className={s.text}>{item.text}</p>
        </Card>
      ))}
    </ul>
  );
}

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function SolutionsBody() {
  const route = v34Route("solutions");
  const action = createWorldAction();
  return (
    <>
      <Hero
        variant="split"
        eyebrow={HERO.eyebrow}
        title={route.heading}
        lead={route.description}
        actions={
          <>
            <ButtonLink href={action.href} tone="primary">{action.label}</ButtonLink>
            <ButtonLink href={EXPLORE_CTA.href} tone="secondary">{EXPLORE_CTA.label}</ButtonLink>
          </>
        }
        art={<Figure art={<SolutionsArt />} caption={HERO.art} />}
      />

      <Section surface="paper" eyebrow={ROLES.eyebrow} title={ROLES.title} lead={ROLES.lead}>
        <PathCards items={ROLES.items} />
      </Section>

      <Section surface="green" eyebrow={FIELDS.eyebrow} title={FIELDS.title} lead={FIELDS.lead}>
        <PathCards items={FIELDS.items} />
      </Section>

      <Section surface="paper" eyebrow={TASKS.eyebrow} title={TASKS.title} lead={TASKS.lead}>
        <ul className={s.triples}>
          {Object.entries(SOLUTIONS).map(([slug, solution]) => (
            <Card key={slug} kicker={solution.eyebrow} title={solution.title} href={`/solutions/${slug}` as Route}>
              <p className={s.audience}>For: {solution.audience}</p>
              <dl className={s.task} aria-label="Input, action and output">
                <div className={s.taskRow}><dt className={s.taskTerm}>Input</dt><dd className={s.taskValue}>{solution.task.input}</dd></div>
                <div className={s.taskRow}><dt className={s.taskTerm}>Action</dt><dd className={s.taskValue}>{solution.task.action}</dd></div>
                <div className={s.taskRow}><dt className={s.taskTerm}>Output</dt><dd className={s.taskValue}>{solution.task.output}</dd></div>
              </dl>
            </Card>
          ))}
        </ul>
      </Section>

      <Bridge eyebrow={BRIDGE.eyebrow} title={BRIDGE.title} text={BRIDGE.text} href={BRIDGE.href} label={BRIDGE.label} />

      <FinalCta title={FINAL.title} />
    </>
  );
}
