import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { CAPABILITY_MANIFEST, describeAcceptedFormats } from "../../../../../shared/capabilityManifest";
import ContactForm from "@/components/contact-form";
import { customerDataState } from "@/lib/activation-policy";
import { primaryCallToAction } from "@/lib/commercial-state";
import { readLegalOperator } from "@/lib/legal-operator";
import { TRAINING_DATA_CLAIM } from "@/lib/security-claims";
import { SUPPORT_ACKNOWLEDGEMENT } from "@/lib/support-targets";
import { v34Route } from "@/lib/v34/routes";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { ContactArt } from "./contact-art";
import {
  ADDRESSES, FINAL, FINAL_LABEL, FIRST_QUESTIONS_TITLE, FORM, GENERAL_INBOX, HERO, PREPARE, READ_BY_A_PERSON,
  RETAINED, TELEPHONE_HOURS, registryPath, retained,
} from "./contact-content";
import s from "./contact.module.css";


/** The six questions a buyer asks before they write. Each answer ends at the page that owns it. */
function FirstQuestions() {
  const formats = describeAcceptedFormats(CAPABILITY_MANIFEST);
  const access = primaryCallToAction();
  const security = registryPath("security");
  const items: Array<{ question: string; answer: ReactNode }> = [
    {
      question: "Are my documents used to train models?",
      answer: <>No. {TRAINING_DATA_CLAIM.body} <Link className={s.inline} href={security} prefetch={false}>Security</Link></>,
    },
    {
      question: "Which model providers see my documents?",
      answer: <>No third-party model API receives your documents today: document reading runs on GPU workers TAVONEL operates, and every document is treated as hostile data. <Link className={s.inline} href={security} prefetch={false}>Security</Link></>,
    },
    {
      question: "What happens when a passage cannot be verified?",
      answer: <>It is held for review and surfaced as such, not published as if it were verified. Fail closed is a property of the compiler, not a setting. <Link className={s.inline} href={retained(RETAINED.trust)} prefetch={false}>Trust Center</Link></>,
    },
    {
      question: "What can I bring?",
      answer: <>{formats}, as files, folders or a ZIP, plus connected sources. Every accepted format is sanitized to PDF and read the same way, so each passage keeps its page and region. <Link className={s.inline} href={retained(RETAINED.sources)} prefetch={false}>Supported sources</Link></>,
    },
    {
      question: "Can I compile my own files today?",
      answer: <>{customerDataState} <Link className={s.inline} href={access.href as Route} prefetch={false}>{access.label}</Link></>,
    },
    {
      question: "Can what I upload be deleted?",
      answer: <>Source material, derived artifacts and compiled packages can be deleted on request, and that request is carried out by a person rather than by a self-service control. <Link className={s.inline} href={security} prefetch={false}>Retention and deletion</Link></>,
    },
  ];
  return (
    <div className={s.faq}>
      {items.map((item) => (
        <details key={item.question} className={s.item}>
          <summary className={s.question}>{item.question}</summary>
          <p className={s.answer}>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

/** The addresses, the telephone where the operator record exists, and what happens after a message is sent. */
function Reach({ operator }: { operator: ReturnType<typeof readLegalOperator> }) {
  return (
    <div className={s.reach}>
      <dl className={s.addresses}>
        {ADDRESSES.map((address) => (
          <div key={address.email} className={s.address}>
            <dt className={s.addressName}>{address.label}</dt>
            <dd className={s.addressValue}><a className={s.mail} href={`mailto:${address.email}`}>{address.email}</a></dd>
          </div>
        ))}
        {operator ? (
          <div className={s.address}>
            <dt className={s.addressName}>Telephone</dt>
            <dd className={s.addressValue}><a className={s.mail} href={`tel:${operator.phone}`}>{operator.phone}</a></dd>
          </div>
        ) : null}
      </dl>
      <div className={s.notes}>
        <p className={s.note}>{SUPPORT_ACKNOWLEDGEMENT}</p>
        <p className={s.note}>{GENERAL_INBOX}{operator ? ` ${TELEPHONE_HOURS}` : ""}</p>
        <p className={s.note}>{READ_BY_A_PERSON}</p>
      </div>
    </div>
  );
}

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function ContactBody() {
  const operator = readLegalOperator();
  const route = v34Route("contact");
  const pricing = registryPath("pricing");
  return (
    <>
      <Hero
        variant="split"
        eyebrow={HERO.eyebrow}
        title={route.heading}
        lead={route.description}
        actions={<ButtonLink href={HERO.primary.href}>{HERO.primary.label}</ButtonLink>}
        art={<Figure art={<ContactArt />} caption={HERO.figureCaption} />}
      />

      <Section id="addresses" surface="paper" title={operator ? "Write or call" : "Write to us"}>
        <Reach operator={operator} />
      </Section>

      <Section id="inquiry" surface="green" title={FORM.title} lead={FORM.lead}>
        {/* "fine" is the site sheet that gives the form its own inline links a 24px target and a hover. */}
        <div className={`fine ${s.formScope}`}>
          <ContactForm />
        </div>
      </Section>

      <Section id="questions" surface="light" title={FIRST_QUESTIONS_TITLE}>
        <FirstQuestions />
      </Section>

      <Section id="prepare" surface="paper" title={PREPARE.title} lead={PREPARE.lead}>
        <ul className={s.prepare}>
          {PREPARE.items.map(([name, text]) => (
            <li key={name} className={s.prepareItem}>
              <h3 className={s.prepareTitle}>{name}</h3>
              <p className={s.prepareBody}>{text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <FinalCta title={FINAL.title} cta={{ href: pricing, label: FINAL_LABEL }} />
    </>
  );
}

export default function Contact() {
  return (
    <V34Page route="contact">
      <RouteJsonLd route="contact" />
      <ContactBody />
    </V34Page>
  );
}
