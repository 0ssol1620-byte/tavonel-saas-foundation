import FileOrRouteLink from "@/components/file-or-route-link";
import { ScrollTable } from "@/components/v34/ui/scroll-table";
import {
  TRUST_PROVISION_STATE_LABEL,
  trustProvisionCounts,
  trustProvisionsByState,
  type TrustProvision,
} from "@/content/trust/provisions";
import s from "./provisions.module.css";

/*
  The Provided / Roadmap / Not provided record, from the one content module `/trust`, `/security`
  and `/enterprise` all read. This file is a layout for those rows and writes none of them: every
  sentence, state and source comes from `content/trust/provisions.ts`, which `lib/trust-provisions.test.ts`
  holds against the pages that publish each fact. Each state prints as a word; colour is never
  the only signal.
*/

/** The sentence that opens the record: the counts are computed, so they cannot drift from the rows. */
export function provisionSummary(): string {
  const counts = trustProvisionCounts();
  return `${counts.provided} in place · ${counts.roadmap} on the roadmap · ${counts.not_provided} absent.`;
}

function cells(row: TrustProvision) {
  return [
    row.subject,
    <>
      <p className={s.line}>{row.line}</p>
      <p className={s.sourceRow}>
        <FileOrRouteLink className={s.source} href={row.source.href}>{row.source.label}</FileOrRouteLink>
      </p>
    </>,
  ];
}

/** Every provision, grouped by state in reading order; a state with no rows renders nothing. */
export function Provisions({ rows }: { rows?: readonly TrustProvision[] }) {
  return (
    <div className={s.groups}>
      {trustProvisionsByState(rows).map(([state, group]) =>
        group.length === 0 ? null : (
          <div key={state} className={s.group} data-state-group={state}>
            <h3 className={s.groupTitle}>
              {TRUST_PROVISION_STATE_LABEL[state]}
              <span className={s.count}>{group.length}</span>
            </h3>
            <ScrollTable
              label={`${TRUST_PROVISION_STATE_LABEL[state]}: what a security review asks for`}
              columns={["What a reviewer asks for", "What is true today"]}
              rows={group.map(cells)}
            />
          </div>
        ),
      )}
    </div>
  );
}
