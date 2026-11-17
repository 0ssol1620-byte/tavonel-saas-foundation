import CompilerContractDiagram from "@/components/compiler-contract-diagram";
import { CONTRACT_CLAUSES, CONTRACT_STATE, INTEROP_STANDARDS, PACKAGE_FORMATS, type ContractClauseState } from "@/lib/compiler-contract";
import { Section } from "@/components/v34/ui/section";
import { CONTRACT, FLOW, INTEROP } from "./changes-content";
import s from "./changes.module.css";

const ordinal = (index: number) => String(index + 1).padStart(2, "0");

/** The two words the contract grades a clause with here, in the order a reader meets them. */
const STATE_KEY: readonly ContractClauseState[] = ["demonstrated", "direction"];

/** The Compiler Contract: the clauses with their states, the source-change flow and the formats that leave the compiler. */
export function ChangesContract() {
  return (
    <>
      <Section id="clauses" surface="paper" eyebrow={CONTRACT.eyebrow} title={CONTRACT.title} lead={CONTRACT.lead}>
        <dl className={s.key}>
          {STATE_KEY.map((state) => (
            <div key={state} className={s.keyRow} data-state={state}>
              <dt className={s.state}>{CONTRACT_STATE[state].label}</dt>
              <dd className={s.keyMeaning}>{CONTRACT_STATE[state].meaning}</dd>
            </div>
          ))}
        </dl>
        <ol className={s.clauses} data-contract-clauses="">
          {CONTRACT_CLAUSES.map((clause, index) => (
            <li className={s.clause} data-contract-clause="" data-state={clause.state} id={clause.id} key={clause.id}>
              <p className={s.clauseHead}>
                <span className={s.kicker}>{ordinal(index)}</span>
                <span className={s.state} data-state-label="">{CONTRACT_STATE[clause.state].label}</span>
              </p>
              <h3 className={s.itemTitle}>{clause.name}</h3>
              <p className={s.itemText}>{clause.promise}</p>
              <details className={s.detail} data-contract-detail="">
                <summary className={s.summary} aria-label={`Read ${clause.name}: explanation and evidence`}>{CONTRACT.check}</summary>
                <div className={s.detailBody}>
                  <p className={s.itemText}>{clause.body}</p>
                  <p className={s.itemText}><b className={s.where}>{CONTRACT.where}</b>{clause.evidence}</p>
                </div>
              </details>
            </li>
          ))}
        </ol>
      </Section>

      <Section surface="light" title={FLOW.title}>
        <details className={s.detail} data-contract-reference="flow">
          <summary className={s.summary}>{FLOW.summary}</summary>
          <div className={s.detailBody}>
            <p className={s.itemText}>{FLOW.lead}</p>
            <div className={s.flow}>
              <CompilerContractDiagram />
            </div>
            <p className={s.itemText}>{FLOW.note}</p>
          </div>
        </details>
      </Section>

      <Section surface="paper" title={INTEROP.title}>
        <details className={s.detail} data-contract-reference="interop">
          <summary className={s.summary}>{INTEROP.summary}</summary>
          <div className={s.detailBody}>
            <p className={s.itemText}>{INTEROP.lead}</p>
            <dl className={s.formats}>
              {PACKAGE_FORMATS.map(([format, path]) => (
                <div key={format} className={s.format}>
                  <dt className={s.formatName}>{format}</dt>
                  <dd className={s.formatPath}>{path}</dd>
                </div>
              ))}
            </dl>
            <p className={s.itemText}>{INTEROP.note}</p>
            <h3 className={s.itemTitle}>{INTEROP.standards}</h3>
            <ul className={s.standards} data-interop-standards="">
              {INTEROP_STANDARDS.map((standard) => (
                <li className={s.standard} data-interop-standard="" data-state={standard.state} key={standard.name}>
                  <b>{standard.name}</b>
                  <span className={s.state} data-state-label="">{CONTRACT_STATE[standard.state].label}</span>
                  <p className={s.itemText}>{standard.note}</p>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </Section>
    </>
  );
}
