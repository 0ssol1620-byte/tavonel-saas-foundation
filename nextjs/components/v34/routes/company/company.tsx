import Link from "next/link";
import { readLegalOperator } from "@/lib/legal-operator";
import { v34Route } from "@/lib/v34/routes";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { Section } from "@/components/v34/ui/section";
import { CompanyArt } from "./company-art";
import {
  DOCUMENTS, FINAL, FINAL_LABEL, HERO, OPERATOR, OWN, PRINCIPLES, QUOTE, registryPath, retained,
} from "./company-content";
import s from "./company.module.css";

const TITLE_SUFFIX = / — TAVONEL$/;
const ordinal = (index: number) => String(index + 1).padStart(2, "0");

/** Four numbered statements, used for both ownership and principles. */
function Four({ items, numbered }: { items: readonly (readonly [string, string])[]; numbered?: boolean }) {
  return (
    <ol className={s.four}>
      {items.map(([name, text], index) => (
        <li key={name} className={s.item}>
          {numbered ? <p className={s.itemNo}>{ordinal(index)}</p> : null}
          <h3 className={s.itemTitle}>{name}</h3>
          <p className={s.itemBody}>{text}</p>
        </li>
      ))}
    </ol>
  );
}

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function CompanyBody() {
  const route = v34Route("company");
  const operator = readLegalOperator();
  return (
    <>
      <Hero
        variant="split"
        eyebrow={HERO.eyebrow}
        title={route.title.replace(TITLE_SUFFIX, "")}
        lead={route.description}
        actions={<ButtonLink href={registryPath("contact")} tone="secondary">Contact</ButtonLink>}
        art={<Figure art={<CompanyArt />} caption={HERO.figureCaption} />}
      />

      <Section id="originators" surface="light" title={OWN.title} lead={OWN.lead}>
        <Four items={OWN.items} numbered />
      </Section>

      <Section id="context" surface="dark">
        <div className={s.quoteGrid}>
          <p className={s.quote}>{QUOTE.line}</p>
          <div className={s.quoteText}>
            {QUOTE.body.map((paragraph) => <p key={paragraph} className={s.quoteBody}>{paragraph}</p>)}
          </div>
        </div>
      </Section>

      <Section id="principles" surface="paper" title={PRINCIPLES.title} lead={PRINCIPLES.lead}>
        <Four items={PRINCIPLES.items} />
      </Section>

      <Section id="documents" surface="light" title={DOCUMENTS.title} lead={DOCUMENTS.lead}>
        <ul className={s.docs}>
          {DOCUMENTS.items.map((doc) => (
            <li key={doc.href} className={s.doc}>
              <Link className={s.docLink} href={retained(doc.href)} prefetch={false}>{doc.label}</Link>
              <p className={s.docText}>{doc.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      {operator ? (
        <Section id="operator" surface="paper" title={OPERATOR.title} lead={OPERATOR.lead}>
          <dl className={s.operator}>
            {[
              ["Business", operator.businessName],
              ["Representative", operator.representative],
              ["Business registration", operator.businessNumber],
              ["Business address", operator.address],
            ].map(([name, value]) => (
              <div key={name} className={s.fact}>
                <dt className={s.factName}>{name}</dt>
                <dd className={s.factValue}>{value}</dd>
              </div>
            ))}
            <div className={s.fact}>
              <dt className={s.factName}>Contact</dt>
              <dd className={s.factValue}>
                <a className={s.opLink} href={`tel:${operator.phone}`}>{operator.phone}</a>
                <a className={s.opLink} href={`mailto:${operator.email}`}>{operator.email}</a>
              </dd>
            </div>
          </dl>
        </Section>
      ) : null}

      <FinalCta title={FINAL.title} cta={{ href: registryPath("platform"), label: FINAL_LABEL }} />
    </>
  );
}

export default function Company() {
  return (
    <V34Page route="company">
      <RouteJsonLd route="company" />
      <CompanyBody />
    </V34Page>
  );
}
