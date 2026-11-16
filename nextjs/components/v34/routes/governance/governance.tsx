import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import s from "./governance.module.css";

const record = v34Route("governance");
const SECURITY = v34Route("security").path;
const EVIDENCE = v34Route("evidence").path;

const STEPS = [
  { title: "Propose", text: "A scoped proposal for the change, citing its sources." },
  { title: "Validate", text: "A check of permissions, limits and the current state of the target." },
  { title: "Approve", text: "A named reviewer's decision to approve, reject or edit the proposal." },
  { title: "Apply", text: "The approved change written to the World, with its result." },
  { title: "Audit", text: "The request, the reviewer and the result, kept together as one trail." },
] as const;

const REVIEW = [
  ["Scope", "Which records the change touches", "Before approval"],
  ["Before and after", "The value today and the value proposed", "Side by side"],
  ["Reason", "The sources that justify the change", "With its evidence"],
  ["Reviewer", "Who decided, and when", "In the trail"],
] as const;

function Art() {
  return (
    <svg className={s.art} viewBox="0 0 480 300" role="img" aria-label="A proposal passes a reviewer and reaches a World, with an audit trail beneath.">
      {["Proposal", "Reviewer", "World"].map((label, i) => (
        <g key={label}>
          <rect className={s.artBox} x={16 + i * 168} y="56" width="128" height="88" rx="10" />
          <text className={s.artText} x={34 + i * 168} y="106">{label}</text>
        </g>
      ))}
      <path className={s.artLine} d="M144 100 H184 M312 100 H352" />
      <rect className={s.artLine} x="16" y="188" width="448" height="2" />
      {[0, 1, 2].map((i) => (
        <rect key={i} className={s.artLine} x="16" y={208 + i * 22} width={300 - i * 60} height="8" rx="3" />
      ))}
      <text className={s.artMuted} x="16" y="180">Audit trail</text>
    </svg>
  );
}

export function GovernanceBody() {
  return (
    <>
      <Hero
        variant="split"
        eyebrow={record.ogLabel}
        title={record.heading}
        lead={record.description}
        actions={<ButtonLink href={SECURITY} tone="onDark">Read the security overview</ButtonLink>}
        art={<Figure framed={false} kind="Illustration" caption="A proposal, a reviewer and a World, with the audit trail beneath." art={<Art />} />}
      />

      <Section surface="paper" eyebrow="The lifecycle" title="From proposal to audit trail" lead="The steps this page sets out for a change to a World, each with the record it leaves.">
        <ul className={s.list}>
          {STEPS.map((p) => (
            <li key={p.title} className={s.item}>
              <h3 className={s.itemTitle}>{p.title}</h3>
              <p className={s.itemText}>{p.text}</p>
            </li>
          ))}
        </ul>
        <p className={s.foot}>
          <a className={s.textLink} href={EVIDENCE}>See how evidence is linked to a record</a>
        </p>
      </Section>

      <Section surface="green" eyebrow="For the reviewer" title="What a reviewer needs before deciding">
        <ScrollTable label="What a reviewer needs on a proposal" columns={["Detail", "What it shows", "Where it belongs"]} rows={REVIEW} />
      </Section>

      <FinalCta title="Compile a World of your own first." />
    </>
  );
}

export default function Governance() {
  return (
    <V34Page route="governance">
      <RouteJsonLd route="governance" />
      <GovernanceBody />
    </V34Page>
  );
}
