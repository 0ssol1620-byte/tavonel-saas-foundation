import Link from "next/link";
import type { Route } from "next";
import {
  DISCLOSURE_STATUS_LABEL,
  PROCESSING_REGIONS,
  TRUST_DISCLOSURES,
} from "@/lib/trust-disclosures";

/*
  The disclosure list, printed the same way on /trust, /security and /enterprise.

  No new CSS. `.status-list` already carries the two-column grid, the mono state word and the
  single-column collapse on a phone, and its `data-state` tokens already mean the three things
  this list means: `operational` is green for what is in place, `closed` is amber for what is
  planned and has not started, `not_configured` is muted for what is absent. A fourth colour
  would have to mean something, and the row already says what it means in words.

  The count is even, which matters: `.status-list > :last-child:nth-child(odd)` stretches a
  trailing odd card to the full width of the section, and the largest object on an enterprise
  page should not be whichever absence happens to sort last.
*/
const STATE_TOKEN = {
  provided: "operational",
  roadmap: "closed",
  not_provided: "not_configured",
} as const;

/*
  The row's link names where it goes, and a row never links to the page it is on.

  Fourteen identical "Where this is maintained" lines is a footer repeated fourteen times, and on
  /security six of them pointed at /security. The Trust Center's own rule applies: a link to where
  you already are is worse than no link.
*/
const DESTINATION: Record<string, string> = {
  "/trust": "More on Trust",
  "/security": "More on Security",
  "/status": "More on Status",
  "/terms": "More in the terms",
  "/contact": "Ask us directly",
};

export function TrustDisclosures({
  heading = "WHAT A SECURITY REVIEW WILL FIND",
  on,
}: {
  heading?: string;
  /** The page rendering the list, so a row does not link to where the reader already is. */
  on?: string;
}) {
  return (
    <>
      <h2>{heading}</h2>
      <div className="status-list">
        {TRUST_DISCLOSURES.map((row) => (
          <article key={row.subject} data-state={STATE_TOKEN[row.status]}>
            <span>{DISCLOSURE_STATUS_LABEL[row.status]}</span>
            <h3>{row.subject}</h3>
            <p>{row.line}</p>
            {row.href && row.href !== on ? (
              <p className="fine"><Link href={row.href as Route}>{DESTINATION[row.href]}</Link></p>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}

/*
  SD-11's region table, on the page a reviewer asks the question from.

  `.src-matrix` is the /sources table: it scrolls horizontally on a narrow desktop and reflows to
  labelled blocks on a phone, which is what a four-column table has to do at 412px. The `region`
  cell prints what configuration fixes, and the one component nothing pins prints that instead of
  a plausible region.
*/
export function ProcessingRegionTable() {
  return (
    <div className="src-scroll">
      <table className="src-matrix">
        <caption>Each region below is the one fixed by this deployment&rsquo;s own configuration.</caption>
        <thead>
          <tr>
            <th scope="col">Component</th>
            <th scope="col">Provider</th>
            <th scope="col">Region</th>
            <th scope="col">What that means</th>
          </tr>
        </thead>
        <tbody>
          {PROCESSING_REGIONS.map((row) => (
            <tr key={row.component}>
              <th scope="row" data-label="Component"><b>{row.component}</b></th>
              <td data-label="Provider">{row.provider}</td>
              <td data-label="Region">{row.region}</td>
              <td data-label="What that means">{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
