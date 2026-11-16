import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import s from "./federation.module.css";

const record = v34Route("federation");
const WORLD = v34Route("world").path;
const SECURITY = v34Route("security").path;

const OWNERSHIP = [
  { title: "Provenance", text: "Keep the source identity, the origin World, the revision and the license or grant." },
  { title: "Permissions", text: "Receiving a reference grants no read access to the source behind it." },
  { title: "Versioning", text: "State whether the recipient follows updates or pins a version." },
  { title: "Revocation", text: "Future reads are denied, and the agreement says what happens to copies already made." },
  { title: "Conflict", text: "Two Worlds can disagree, and each keeps its own record without a single global ontology." },
] as const;

const TERMS = [
  ["Scope", "Which records the grant covers."],
  ["Access", "Whether the recipient reads or also imports."],
  ["Version", "A pinned release, or a followed channel."],
  ["Expiry", "When the grant ends."],
  ["Revocation", "What changes for future retrieval."],
] as const;

function Art() {
  return (
    <svg className={s.art} viewBox="0 0 480 300" role="img" aria-label="Three separate Worlds. The first shares a selected subset with the second through a grant, and a dashed line marks a revoked reference to the third.">
      <circle className={s.artBox} cx="90" cy="150" r="64" />
      <text className={s.artText} x="62" y="155">World A</text>
      <circle className={s.artBox} cx="390" cy="86" r="52" />
      <text className={s.artText} x="362" y="91">World B</text>
      <circle className={s.artBox} cx="390" cy="218" r="52" />
      <text className={s.artText} x="362" y="223">World C</text>
      <path className={s.artLine} d="M150 130 L338 92" />
      <text className={s.artMuted} x="210" y="96">grant</text>
      <path className={s.artLine} strokeDasharray="6 6" d="M148 172 L340 208" />
      <text className={s.artMuted} x="200" y="214">revoked</text>
    </svg>
  );
}

export function FederationBody() {
  return (
    <>
      <Hero
        variant="split"
        eyebrow={record.ogLabel}
        title={record.title}
        lead={record.description}
        actions={<ButtonLink href={WORLD} tone="onDark">Inspect a public reference World</ButtonLink>}
        art={<Figure framed={false} kind="Illustration" caption="Worlds exchange a selected subset through a grant and keep their own sources." art={<Art />} />}
      />

      <Section surface="paper" eyebrow="The agreement" title="A selective exchange" lead="One World publishes a view, a grant sets its terms, and another World receives it.">
        <ScrollTable label="Terms of an exchange agreement" columns={["Term", "What it decides"]} rows={TERMS} />
      </Section>

      <Section surface="green" eyebrow="Ownership" title="Keep ownership clear" lead="A cross-World reference needs more than an invitation link.">
        <ul className={`${s.list} ${s.three}`}>
          {OWNERSHIP.map((o) => (
            <li key={o.title} className={s.item}>
              <h3 className={s.itemTitle}>{o.title}</h3>
              <p className={s.itemText}>{o.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <FinalCta title="Review the security boundary." cta={{ href: SECURITY, label: "Read about security" }} />
    </>
  );
}

export default function Federation() {
  return (
    <V34Page route="federation">
      <RouteJsonLd route="federation" />
      <FederationBody />
    </V34Page>
  );
}
