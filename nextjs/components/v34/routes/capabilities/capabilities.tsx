import Link from "next/link";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import V34Page from "@/components/v34/shell/v34-page";
import { CorpusStats } from "@/components/v34/ui/corpus-stats";
import { Figure } from "@/components/v34/ui/figure";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Hero } from "@/components/v34/ui/hero";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import { Section } from "@/components/v34/ui/section";
import { activationPolicy, customerDataState } from "@/lib/activation-policy";
import { readCapabilities, type StatusResponse } from "@/lib/capabilities";
import { CONTRACT_CLAUSES, CONTRACT_STATE, type ContractClauseState } from "@/lib/compiler-contract";
import { v34Route } from "@/lib/v34/routes";
import {
  capabilityCensus, publicCapabilityRows, sharedAcceptedLimitationLabels,
} from "../../../../../shared/capabilityManifest";
import { CONTRACT, DEPLOYMENT, EXPLORE, FINAL, FORMATS, HERO } from "./capabilities-content";
import { readStatusBounded, type StatusRead } from "./capabilities-status";
import s from "./capabilities.module.css";


/** "01", "02", ... counted from the list position. */
const ordinal = (index: number) => String(index + 1).padStart(2, "0");

const STATES = Object.keys(CONTRACT_STATE) as ContractClauseState[];

/** One point per clause on a ring: filled where the clause is demonstrated, outlined where it is direction. */
function ClauseRing() {
  const count = CONTRACT_CLAUSES.length;
  return (
    <svg className={s.ring} viewBox="0 0 400 200" role="img" aria-label={HERO.figure}>
      <circle className={s.orbit} cx="200" cy="100" r="74" />
      <circle className={s.core} cx="200" cy="100" r="9" />
      {CONTRACT_CLAUSES.map((clause, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        const x = (200 + Math.cos(angle) * 74).toFixed(1);
        const y = (100 + Math.sin(angle) * 74).toFixed(1);
        return (
          <g key={clause.id}>
            <line className={s.spoke} x1="200" y1="100" x2={x} y2={y} />
            <circle className={clause.state === "direction" ? s.pointOutline : s.pointFilled} cx={x} cy={y} r="8" />
          </g>
        );
      })}
    </svg>
  );
}

/** The page body, without the V34 frame, so it can be rendered on its own. */
export function CapabilitiesBody({ status, failed }: { status: StatusResponse | null; failed: boolean }) {
  const record = v34Route("capabilities");
  const census = capabilityCensus();
  const rows = publicCapabilityRows();
  const deployment = readCapabilities(status, failed);
  const shared = sharedAcceptedLimitationLabels();
  return (
    <>
      <Hero
        variant="split"
        eyebrow={record.ogLabel}
        title={record.heading}
        lead={record.description}
        art={<Figure art={<ClauseRing />} caption={HERO.figure} />}
      />

      <Section surface="paper" eyebrow={CONTRACT.eyebrow} title={CONTRACT.title} lead={CONTRACT.lead}>
        <dl className={s.states}>
          {STATES.map((state) => (
            <div key={state} className={s.stateItem}>
              <dt className={s.stateLabel}>{CONTRACT_STATE[state].label}</dt>
              <dd className={s.stateMeaning}>{CONTRACT_STATE[state].meaning}</dd>
            </div>
          ))}
        </dl>
        <ol className={s.clauses}>
          {CONTRACT_CLAUSES.map((clause, i) => (
            <li key={clause.id} id={clause.id} className={s.clause}>
              <p className={s.clauseNo}>{ordinal(i)}</p>
              <div className={s.clauseBody}>
                <h3 className={s.clauseName}>{clause.name}</h3>
                <p className={s.promise}>{clause.promise}</p>
                <details className={s.check}>
                  <summary className={s.checkSummary}>{CONTRACT.check}</summary>
                  <p className={s.checkText}>{clause.evidence}</p>
                </details>
              </div>
              <p className={s.clauseState}>{CONTRACT_STATE[clause.state].label}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section surface="green" eyebrow={FORMATS.eyebrow} title={FORMATS.title} lead={FORMATS.lead}>
        <div className={s.formatStats}>
          <CorpusStats
            stats={[
              { label: FORMATS.stats.listed, value: census.total },
              { label: FORMATS.stats.accepted, value: census.accepted },
              { label: FORMATS.stats.converted, value: census.converted },
            ]}
          />
        </div>
        <ScrollTable
          label={FORMATS.table}
          columns={FORMATS.columns}
          rows={rows.map((row) => [
            `${row.sourceFamily} · ${row.extensions.join(", ")}`,
            row.tier,
            row.preserved.length ? row.preserved.join(", ") : "—",
            row.specific.length ? row.specific.join("; ") : "—",
          ])}
        />
        <div className={s.shared}>
          <h3 className={s.sharedTitle}>{FORMATS.shared}</h3>
          <ul className={s.sharedList}>
            {shared.map((label) => <li key={label}>{label}</li>)}
          </ul>
        </div>
        <p className={s.formatsLink}>
          <Link className={s.inlineLink} href={FORMATS.link.href} prefetch={false}>{FORMATS.link.label}</Link>
        </p>
      </Section>

      <Section surface="paper" eyebrow={DEPLOYMENT.eyebrow} title={DEPLOYMENT.title} lead={DEPLOYMENT.lead}>
        <ScrollTable
          label={DEPLOYMENT.table}
          columns={DEPLOYMENT.columns}
          rows={deployment.map((row) => [row.name, row.state, row.note === activationPolicy.customerData.reason ? customerDataState : row.note])}
        />
      </Section>

      <Section surface="light" eyebrow={EXPLORE.eyebrow} title={EXPLORE.title}>
        <ul className={s.explore}>
          {EXPLORE.items.map((item) => (
            <li key={item.href} className={s.exploreItem}>
              <Link className={s.exploreLink} href={item.href} prefetch={false}>
                <span className={s.exploreTitle}>{item.title} <span aria-hidden="true">→</span></span>
                <span className={s.exploreText}>{item.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <FinalCta title={FINAL.title} cta={FINAL.cta} />
    </>
  );
}

export default async function Capabilities({ read = readStatusBounded }: { read?: () => Promise<StatusRead> } = {}) {
  const { status, failed } = await read();
  return (
    <V34Page route="capabilities" surface="paper">
      <RouteJsonLd route="capabilities" />
      <CapabilitiesBody status={status} failed={failed} />
    </V34Page>
  );
}
