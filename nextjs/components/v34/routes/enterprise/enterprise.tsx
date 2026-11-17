import Link from "next/link";
import FileOrRouteLink from "@/components/file-or-route-link";
import { TRUST_PROVISIONS } from "@/content/trust/provisions";
import { signedProductDemo } from "@/lib/signed-product-demo";
import { v34Route } from "@/lib/v34/routes";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { Provisions, provisionSummary } from "../security/provisions";
import { PROVISIONS } from "../security/security-content";
import { EnterpriseArt } from "./enterprise-art";
import {
  COST, FINAL, HERO, JUMP, OPERATIONS, PILOT, RETAINED, REVIEW, SCOPED, TASKS, TRACE,
  registryPath, retained, type JumpId,
} from "./enterprise-content";
import { SampleFrame } from "./sample-frame";
import s from "./enterprise.module.css";

const ordinal = (index: number) => String(index + 1).padStart(2, "0");

/** The numbered steps both chains share. */
function Steps({ steps }: { steps: readonly (readonly [string, string])[] }) {
  return (
    <ol className={s.chain}>
      {steps.map(([name, text], index) => (
        <li key={name} className={s.step}>
          <p className={s.stepNo}>{ordinal(index)}</p>
          <h3 className={s.stepTitle}>{name}</h3>
          <p className={s.stepBody}>{text}</p>
        </li>
      ))}
    </ol>
  );
}

/** A provision row's sentence, by id. A card whose row is missing is a defect, not an empty card. */
function provisionLine(id: string): string {
  const row = TRUST_PROVISIONS.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`enterprise_provision_missing:${id}`);
  return row.line;
}

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function EnterpriseBody() {
  const route = v34Route("enterprise");
  const contact = registryPath("contact");
  const security = registryPath("security");

  return (
    <>
      <Hero
        variant="split"
        eyebrow={HERO.eyebrow}
        title={route.heading}
        lead={route.description}
        actions={
          <>
            <ButtonLink href={contact}>{HERO.primary}</ButtonLink>
            <ButtonLink href={HERO.secondary.href} tone="secondary">{HERO.secondary.label}</ButtonLink>
          </>
        }
        art={<Figure art={<EnterpriseArt />} caption={HERO.figureCaption} />}
      />

      <Section id={"team" satisfies JumpId} surface="paper" title={TASKS.title} lead={TASKS.lead}>
        <nav aria-label="On this page">
          <ul className={s.jump}>
            {(Object.entries(JUMP) as [JumpId, string][]).map(([id, label]) => (
              <li key={id}><a className={s.jumpLink} href={`#${id}`}>{label}</a></li>
            ))}
          </ul>
        </nav>
        <ul className={s.tasks}>
          {TASKS.items.map(([title, body]) => (
            <li key={title} className={s.task}>
              <h3 className={s.taskTitle}>{title}</h3>
              <p className={s.taskBody}>{body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id={"trace" satisfies JumpId} surface="light" title={TRACE.title}>
        <SampleFrame demo={signedProductDemo} />
        <Steps steps={TRACE.steps} />
      </Section>

      <Section id={"run" satisfies JumpId} surface="green" title={OPERATIONS.title}>
        <ul className={s.items}>
          {OPERATIONS.items.map(([title, body]) => (
            <li key={title} className={s.item}>
              <h3 className={s.itemTitle}>{title}</h3>
              <p className={s.itemBody}>{body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id={"pilot" satisfies JumpId} surface="paper" title={PILOT.title}>
        <Steps steps={PILOT.steps} />
        <p className={s.prose}>{PILOT.outcome}</p>
      </Section>

      <Section id={"scoped" satisfies JumpId} surface="light" title={SCOPED.title} lead={SCOPED.lead}>
        <ul className={s.scoped}>
          {SCOPED.cards.map((card) => (
            <li key={card.title} className={s.scopedCard}>
              <p className={s.scopedLabel}>{SCOPED.label}</p>
              <h3 className={s.scopedTitle}>{card.title}</h3>
              <p className={s.scopedBody}>{provisionLine(card.provision)}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id={"review" satisfies JumpId} surface="paper" title={REVIEW.title} lead={`${PROVISIONS.lead} ${provisionSummary()}`}>
        <Provisions />
        <p className={s.prose}>
          Review the maintained public record in the{" "}
          <Link className={s.inline} href={retained(RETAINED.trust)} prefetch={false}>Trust Center</Link> and{" "}
          <Link className={s.inline} href={security} prefetch={false}>Security</Link>. Deployment-specific architecture,
          control evidence and questionnaire responses are provided during a qualified review.
          A self-service workspace is covered by the{" "}
          <FileOrRouteLink className={s.inline} href={RETAINED.addendum}>processing addendum</FileOrRouteLink> its
          owner accepts with the{" "}
          <Link className={s.inline} href={retained(RETAINED.terms)} prefetch={false}>self-service terms</Link>. An
          Enterprise engagement can negotiate a separately executed data processing agreement
          during scoping, starting from the{" "}
          <FileOrRouteLink className={s.inline} href={RETAINED.dpaTemplate}>archived 2026-09-23 template</FileOrRouteLink>, which
          is a draft for review and not a signed agreement. Once executed, the signed agreement
          prevails within its scope.
        </p>
      </Section>

      <Section id={"cost" satisfies JumpId} surface="light" title={COST.title}>
        <p className={s.proseTight}>
          The published plans and the pages each one includes are on{" "}
          <Link className={s.inline} href={registryPath("pricing")} prefetch={false}>Pricing</Link>, in US dollars and
          excluding tax. {COST.paragraph}
        </p>
      </Section>

      <FinalCta title={FINAL.title} cta={{ href: contact, label: HERO.primary }} secondary={{ href: security, label: FINAL.secondary }} />
    </>
  );
}

export default function Enterprise() {
  return (
    <V34Page route="enterprise">
      <RouteJsonLd route="enterprise" />
      <EnterpriseBody />
    </V34Page>
  );
}
