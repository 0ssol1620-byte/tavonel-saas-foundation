import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ButtonLink } from "@/components/v34/ui/button-link";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { Hero } from "@/components/v34/ui/hero";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { v34Route } from "@/lib/v34/routes";
import s from "./outcomes.module.css";

const record = v34Route("outcomes");
const EVIDENCE = v34Route("evidence").path;
const METHODS = v34Route("methods").path;

const PARTS = [
  { title: "What was measured", text: "One named measure, such as answer correctness or time to a first answer." },
  { title: "Over what period", text: "The dates the measure covers, so a result can be placed in time." },
  { title: "From which source", text: "A link to the data the figure was read from, so a reader can check it." },
  { title: "Against what", text: "The same task run under a baseline and under a candidate, with the conditions written down." },
] as const;

const DESIGN = [
  ["Baseline", "The same model, tools and task budget, without compiled context", "Held constant"],
  ["Candidate", "The same task with authorized, pinned context from a World", "Changes by one condition"],
  ["Quality", "Whether the source, its date and the claim are correct", "Checked against exact locators"],
  ["Cost", "The cost of each accepted unit, from receipts", "Read from the run record"],
] as const;

function Art() {
  return (
    <svg className={s.art} viewBox="0 0 480 300" role="img" aria-label="A report card with a baseline row, a candidate row and a source link.">
      <rect className={s.artBox} x="16" y="24" width="448" height="252" rx="10" />
      <text className={s.artText} x="36" y="56">Outcome report</text>
      {[0, 1].map((i) => (
        <g key={i}>
          <text className={s.artMuted} x="36" y={96 + i * 56}>{i === 0 ? "Baseline" : "Candidate"}</text>
          <rect className={s.artLine} x="132" y={84 + i * 56} width="300" height="16" rx="4" />
        </g>
      ))}
      <rect className={s.artLine} x="36" y="196" width="396" height="2" />
      <text className={s.artMuted} x="36" y="228">Period</text>
      <text className={s.artMuted} x="36" y="256">Source</text>
      <rect className={s.artBox} x="132" y="214" width="120" height="20" rx="10" />
      <rect className={s.artBox} x="132" y="242" width="176" height="20" rx="10" />
    </svg>
  );
}

export function OutcomesBody() {
  return (
    <>
      <Hero
        variant="split"
        eyebrow={record.ogLabel}
        title={record.heading}
        lead={record.description}
        actions={<ButtonLink href={EVIDENCE} tone="onDark">See how evidence is linked</ButtonLink>}
        art={<Figure framed={false} kind="Illustration" caption="An outcome report: a baseline, a candidate, a period and a source." art={<Art />} />}
      />

      <Section surface="paper" eyebrow="Each report" title="What an outcome report states" lead="A report is a measured comparison with its source attached.">
        <ul className={s.list}>
          {PARTS.map((p) => (
            <li key={p.title} className={s.item}>
              <h3 className={s.itemTitle}>{p.title}</h3>
              <p className={s.itemText}>{p.text}</p>
            </li>
          ))}
        </ul>
        <p className={s.foot}>
          <a className={s.textLink} href={METHODS}>Read how each step is checked</a>
        </p>
      </Section>

      <Section surface="green" eyebrow="Evaluation design" title="Same task, two conditions">
        <ScrollTable label="How a baseline and a candidate are compared" columns={["Part", "Definition", "How it is kept honest"]} rows={DESIGN} />
      </Section>

      <FinalCta title="Compile a World of your own first." />
    </>
  );
}

export default function Outcomes() {
  return (
    <V34Page route="outcomes">
      <RouteJsonLd route="outcomes" />
      <OutcomesBody />
    </V34Page>
  );
}
