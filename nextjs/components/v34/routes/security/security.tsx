import Link from "next/link";
import { TRUST_SEQUENCE } from "@/components/trust-next";
import { signedProductDemo } from "@/lib/signed-product-demo";
import { v34Route } from "@/lib/v34/routes";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { Bridge } from "@/components/v34/ui/bridge";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { Tag } from "@/components/v34/ui/tag";
import { Provisions, provisionSummary } from "./provisions";
import { SecurityArt } from "./security-art";
import {
  ASSURANCE_TITLE, BOUNDARY, CONTROLS, FINAL, HERO, JUMP, NEXT, PROVISIONS, RETAINED, VERIFY,
  registryPath, retained,
} from "./security-content";
import s from "./security.module.css";

const TITLE_SUFFIX = / — TAVONEL$/;
const ordinal = (index: number) => String(index + 1).padStart(2, "0");
const shortDigest = (value: string) => `${value.slice(0, 16)}…${value.slice(-8)}`;

/** The sample package's figures, read from the compiled demo. A package that does not verify is not shown. */
function SamplePackage() {
  const { signedExport } = signedProductDemo;
  if (!signedExport.verified) throw new Error("security_sample_package_not_verified");
  const facts = [
    ["Files", String(signedExport.fileCount)],
    ["Signature", signedExport.signature.algorithm],
    ["Manifest", shortDigest(signedExport.manifestDigest)],
    ["Checked", "Signature verified when this page was built"],
  ] as const;
  return (
    <div className={s.sample}>
      <Tag kind="Sample" />
      <h3 className={s.sampleTitle}>{VERIFY.sampleTitle}</h3>
      <dl className={s.facts}>
        {facts.map(([name, value]) => (
          <div key={name} className={s.fact}>
            <dt className={s.factName}>{name}</dt>
            <dd className={s.factValue}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function SecurityBody() {
  const route = v34Route("security");
  const position = TRUST_SEQUENCE.findIndex((step) => step.href === route.path);
  const next = TRUST_SEQUENCE[position + 1];
  if (position < 0 || !next) throw new Error("security_not_in_trust_sequence");
  const contact = registryPath("contact");

  return (
    <>
      <Hero
        variant="split"
        eyebrow={HERO.eyebrow}
        title={route.title.replace(TITLE_SUFFIX, "")}
        lead={route.description}
        actions={
          <>
            <ButtonLink href={HERO.primary.href}>{HERO.primary.label}</ButtonLink>
            <ButtonLink href={HERO.secondary.href} tone="secondary">{HERO.secondary.label}</ButtonLink>
          </>
        }
        art={<Figure art={<SecurityArt />} caption={HERO.figureCaption} />}
      />

      <Section id="boundary" surface="paper" title={BOUNDARY.title} lead={BOUNDARY.lead}>
        <nav aria-label="On this page">
          <ul className={s.jump}>
            {JUMP.map((item) => (
              <li key={item.id}><a className={s.jumpLink} href={`#${item.id}`}>{item.label}</a></li>
            ))}
          </ul>
        </nav>
        <ol className={s.chain}>
          {BOUNDARY.steps.map(([name, text], index) => (
            <li key={name} className={s.step}>
              <p className={s.stepNo}>{ordinal(index)}</p>
              <h3 className={s.stepTitle}>{name}</h3>
              <p className={s.stepBody}>{text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="controls" surface="light" title={CONTROLS.title}>
        <ul className={s.controls}>
          {CONTROLS.items.map(([title, body]) => (
            <li key={title} className={s.control}>
              <h3 className={s.controlTitle}>{title}</h3>
              <p className={s.controlBody}>{body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="verify" surface="dark" title={VERIFY.title} lead={VERIFY.lead} aside={<SamplePackage />}>
        {VERIFY.body.map((paragraph) => <p key={paragraph} className={s.verifyText}>{paragraph}</p>)}
        <ul className={s.links}>
          {VERIFY.links.map((link) => (
            <li key={link.href}><a className={s.textLink} href={link.href}>{link.label}</a></li>
          ))}
        </ul>
      </Section>

      <Section id="provisions" surface="paper" title={PROVISIONS.title} lead={`${PROVISIONS.lead} ${provisionSummary()}`}>
        <Provisions />
      </Section>

      <Section id="assurance" surface="light" title={ASSURANCE_TITLE}>
        <p className={s.prose}>
          Public privacy, subprocessor and disclosure records are maintained in the{" "}
          <Link className={s.inline} href={retained(RETAINED.trust)} prefetch={false}>Trust Center</Link>. A qualified review can also
          receive the architecture, control evidence and questionnaire responses relevant to its
          deployment under an appropriate review process.
        </p>
        <p className={s.prose}>
          Retention and deletion are described in the{" "}
          <Link className={s.inline} href={retained(RETAINED.privacy)} prefetch={false}>privacy notice</Link>. Security questions and
          responsible disclosure reports can be sent through the{" "}
          <Link className={s.inline} href={contact} prefetch={false}>contact page</Link>.
        </p>
      </Section>

      <Bridge eyebrow={NEXT.eyebrow} title={`Next: ${next.label}`} text={next.question} href={registryPath("evidence")} label={NEXT.action} />
      <FinalCta title={FINAL.title} cta={{ href: contact, label: FINAL.label }} />
    </>
  );
}

export default function Security() {
  return (
    <V34Page route="security">
      <RouteJsonLd route="security" />
      <SecurityBody />
    </V34Page>
  );
}
