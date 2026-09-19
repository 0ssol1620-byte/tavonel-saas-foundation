/*
  The snapshot step, and what arrived between the two snapshots.

  Both labels and every arrival are read out of `exploreChangeStory`, so every digit in here has
  a receipt and each one is marked `data-derived` for the walk in `e2e/landing-v2.spec.ts`.

  The word is "arrived", never "revised", and that is a product fact rather than a style choice
  (contract rule 7): nothing in the 2025 Form 10-K was reissued. Four later filings landed on top
  of it, and the snapshot after is a complete compile of the larger corpus. The caller supplies
  the heading, which is the only copy in the component -- D10 keeps this primitive reusable, and
  a primitive that spelled "Filings that arrived" itself would carry this landing's sentence into
  the product.
*/
export default function RevisionBadge({
  beforeLabel,
  afterLabel,
  arrivalsLabel,
  arrivals,
  className = "",
}: {
  beforeLabel: string;
  afterLabel: string;
  arrivalsLabel: string;
  arrivals: readonly { form: string; filingDate: string }[];
  className?: string;
}) {
  return (
    <div className={`lv2-revision lv2-panel ${className}`.trim()}>
      <p className="lv2-revision-step lv2-meta">
        <span data-derived="1">{beforeLabel}</span>
        <span aria-hidden="true" className="lv2-revision-arrow">
          →
        </span>
        <span data-derived="1" className="lv2-revision-after">
          {afterLabel}
        </span>
      </p>
      <p className="lv2-revision-title lv2-meta">{arrivalsLabel}</p>
      <ul className="lv2-revision-list">
        {arrivals.map((arrival) => (
          <li key={`${arrival.form}-${arrival.filingDate}`} className="lv2-meta" data-derived="1">
            <i aria-hidden="true" />
            {arrival.form} · {arrival.filingDate}
          </li>
        ))}
      </ul>
    </div>
  );
}
