import type { SiteLink } from "@/lib/site-navigation";
import { ButtonLink } from "./button-link";
import { createWorldAction } from "./create-world";
import { surfaceClass } from "./surface";
import s from "./final-cta.module.css";

/**
 * The closing strip of a page: one heading, one action. The action is "Create your World" and goes
 * where `primaryCallToAction()` says; a page that needs another action passes it as `cta`.
 */
export function FinalCta({ title, cta, tone = "routeFoot" }: {
  title: string;
  cta?: SiteLink;
  /** The route strip, or the stronger green close the home page uses. */
  tone?: "routeFoot" | "final";
}) {
  const action = cta ?? createWorldAction();
  return (
    <section className={`${surfaceClass(tone)} ${s.strip}`} aria-labelledby="v34-final-title">
      <div className={s.shell}>
        <h2 id="v34-final-title" className={s.title}>{title}</h2>
        <ButtonLink href={action.href} tone="primary">{action.label}</ButtonLink>
      </div>
    </section>
  );
}
