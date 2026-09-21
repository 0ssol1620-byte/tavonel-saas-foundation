import Link from "next/link";
import type { Route } from "next";
import {
  TRUST_PROVISIONS,
  TRUST_PROVISION_STATE_LABEL,
  TRUST_PROVISION_STATE_TOKEN,
  trustProvisionCounts,
  trustProvisionsByState,
  type TrustProvision,
} from "@/content/trust/provisions";

/*
  The Provided / Roadmap / Not provided table, rendered from one content module on three pages.

  Gap #6 and #15 of the 2026-09-22 competitor visual audit. `/trust` and `/security` between them
  carry every fact a security reviewer needs and carry it as four pages of prose, so the reviewer
  assembles the checklist themselves and a buyer who stops reading at the second screen leaves
  with a guess. The table is a re-arrangement, not new copy: `content/trust/provisions.ts` is the
  one list, and `/enterprise` -- where the security buyer actually arrives -- renders the same
  rows rather than a summary of them.

  What it is not allowed to become:

  - a certification strip. Nothing held is claimed, and nothing not held gets a badge or a logo.
    The absent assurance report is a row that says so, in the draft agreement's own words, and
    `lib/trust-provisions.test.ts` fails on an image, an SVG or a background image anywhere in here.
  - a glyph table. A tick and a dash are readable as a scale, and a reviewer scanning at speed
    reads a scale as a score. Every cell prints its state as a word, and the colour chip is the
    second signal rather than the only one.

  The colour comes from the four design-system status tokens, chosen by the same rule /sources
  uses: `--verified` for what is in place, `--changed` for what a person still has to sign or
  decide, `--reused` for an absence. No hue means anything the state's own name does not say.
*/

function Row({ row }: { row: TrustProvision }) {
  return (
    <tr data-provision-id={row.id} data-state={row.state}>
      <th scope="row" data-label="What a reviewer asks for">{row.subject}</th>
      <td data-label="State">
        <span className="src-tier" data-token={TRUST_PROVISION_STATE_TOKEN[row.state]}>
          {TRUST_PROVISION_STATE_LABEL[row.state]}
        </span>
      </td>
      <td data-label="What is true today">
        {row.line}{" "}
        <Link className="provision-source" href={row.source.href as Route}>{row.source.label}</Link>
      </td>
    </tr>
  );
}

export default function TrustProvisions({
  id = "provisions",
  heading = "What is in place, what is coming, and what is absent",
}: {
  id?: string;
  heading?: string;
}) {
  const counts = trustProvisionCounts();
  const titleId = `${id}-title`;

  return (
    <>
      <h2 id={titleId}>{heading}</h2>
      <p className="fine">
        Every row below is already stated on the page it links to; this is the same record in the
        order a security review asks for it. {counts.provided} in place · {counts.roadmap} on the
        roadmap · {counts.not_provided} absent.
      </p>
      {/*
        The wrapper carries the scroll, not the table: `display: block` on a table takes its row
        and column semantics with it. At 360px `.docs-table:has(td[data-label])` stacks each row
        into a labelled block instead, which is why every cell carries `data-label`.
      */}
      <div className="table-scroll">
        <table className="docs-table trust-provisions" aria-labelledby={titleId}>
          <thead>
            <tr>
              <th scope="col">What a reviewer asks for</th>
              <th scope="col">State</th>
              <th scope="col">What is true today</th>
            </tr>
          </thead>
          {/*
            Grouped by state so the absences are read after what is in place rather than instead
            of it, and so a reader can stop at the group they came for. A group with no rows
            renders nothing at all.
          */}
          {trustProvisionsByState().map(([state, rows]) =>
            rows.length === 0 ? null : (
              <tbody key={state} data-state-group={state}>
                {rows.map((row) => <Row key={row.id} row={row} />)}
              </tbody>
            ),
          )}
        </table>
      </div>
    </>
  );
}
