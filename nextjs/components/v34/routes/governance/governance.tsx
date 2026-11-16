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
  { title: "Propose", text: "A change is written as a scoped proposal that cites its sources." },
  { title: "Validate", text: "Permissions, limits and the current state of the target are checked." },
  { title: "Approve", text: "A named reviewer approves, rejects or edits the proposal." },
  { title: "Apply", text: "The approved change reaches the World and the result is recorded." },
  { title: "Audit", text: "The request, the reviewer and the result stay in the trail." },
] as const;

const REVIEW = [
  ["Scope", "Which records the change touches", "Listed before approval"],
  ["Before and after", "The value today and the value proposed", "Shown side by side"],
  ["Reason", "The sources that justify the change", "Linked to evidence"],
  ["Reviewer", "Who decided, and when", "Kept in the trail"],
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
        title={record.title.replace(/ — TAVONEL$/, "")}
        lead={record.description}
        actions={<ButtonLink href={SECURITY} tone="onDark">Read the security overview</ButtonLink>}
        art={<Figure framed={false} kind="Illustration" caption="A proposal, a reviewer and a World, with the audit trail beneath." art={<Art />} />}
      />

      <Section surface="paper" eyebrow="The lifecycle" title="From proposal to audit trail" lead="Each change passes through the same steps, and each step leaves a record.">
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

      <Section surface="green" eyebrow="For the reviewer" title="What a reviewer sees before deciding">
        <ScrollTable label="What a reviewer sees on a proposal" columns={["Detail", "What it shows", "How it is presented"]} rows={REVIEW} />
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
