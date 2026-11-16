import Link from "next/link";
import type { Route } from "next";
import type { SiteLink } from "@/lib/site-navigation";
import { ButtonLink } from "./button-link";
import { createWorldAction } from "./create-world";
import { surfaceClass } from "./surface";
import { Eyebrow } from "./text";
import s from "./final-cta.module.css";

/**
 * The closing strip of a page: one heading, one action. The action is "Create your World" and goes
 * where `primaryCallToAction()` says; a page that needs another action passes it as `cta`. The `final`
 * tone is the home page's large close: an optional eyebrow over a two-line heading, with the action
 * and an optional second link stacked at the right.
 */
export function FinalCta({ title, cta, tone = "routeFoot", eyebrow, secondary }: {
  title: string;
  cta?: SiteLink;
  eyebrow?: string;
  secondary?: SiteLink;
  /** The route strip, or the stronger green close the home page uses. */
  tone?: "routeFoot" | "final";
}) {
  const action = cta ?? createWorldAction();
  return (
    <section className={`${surfaceClass(tone)} ${s.strip} ${tone === "final" ? s.large : ""}`} aria-labelledby="v34-final-title">
      <div className={s.shell}>
        <div className={s.main}>
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h2 id="v34-final-title" className={s.title}>{title}</h2>
        </div>
        <div className={s.actions}>
          <ButtonLink href={action.href} tone="primary">{action.label}</ButtonLink>
          {secondary ? <Link className={s.secondary} href={secondary.href as Route} prefetch={false}>{secondary.label}</Link> : null}
        </div>
      </div>
    </section>
  );
}
