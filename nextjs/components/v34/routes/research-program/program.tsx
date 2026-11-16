import Link from "next/link";
import type { Route } from "next";
import { TrustNext } from "@/components/trust-next";
import { Hero } from "@/components/v34/ui/hero";
import { RecordCard } from "@/components/v34/ui/record-card";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import { ALSO, AREAS, HERO, METHOD, RETAINED } from "./program-content";
import s from "./program.module.css";

/** "01", "02", ... counted from the list position. */
const ordinal = (index: number) => String(index + 1).padStart(2, "0");

const link = (href: Route, label: string) => (
  <Link className={s.textLink} href={href} prefetch={false}>{label}</Link>
);

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function ProgramBody() {
  return (
    <>
      <Hero
        variant="sub"
        eyebrow={HERO.eyebrow}
        title={HERO.title}
        lead={
          <>
            {HERO.lede}{" "}
            <Link className={s.inlineLink} href={RETAINED.notes} prefetch={false}>Research notes</Link>.
          </>
        }
      />

      <Section surface="paper" title={AREAS.title}>
        <ul className={s.areas}>
          {AREAS.items.map(([title, body], i) => (
            <li key={title} className={s.area}>
              <RecordCard kind={`Area ${ordinal(i)}`} label={title}>{body}</RecordCard>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        surface="green"
        title={METHOD.title}
        lead={
          <>
            Each rule below is enforced on a published figure by the validator described on{" "}
            <Link className={s.inlineLink} href={RETAINED.benchmarks} prefetch={false}>Benchmarks</Link>,
            which refuses a record that breaks one.
          </>
        }
      >
        <ol className={s.rules}>
          {METHOD.items.map(([title, body], i) => (
            <li key={title} className={s.rule}>
              <p className={s.ruleNo}>{ordinal(i)}</p>
              <h3 className={s.ruleTitle}>{title}</h3>
              <p className={s.ruleText}>{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section surface="paper" title={ALSO.title}>
        <p className={s.also}>
          {link(RETAINED.notes, "Research notes")}
          {link(v34Route("evidence").path, ALSO.evidenceLabel)}
          {link(RETAINED.benchmarks, "Benchmarks")}
          {link(RETAINED.reproducibility, "Reproducibility")}
          {link(RETAINED.trust, "Trust")}
        </p>
        <div className={s.next}>
          <TrustNext from="/research/program" />
        </div>
      </Section>
    </>
  );
}
