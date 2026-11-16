import s from "./personal.module.css";

/** Drawn for this page: three pages feed one record, and the citation line runs back to its page. */
export function PersonalArt() {
  return (
    <svg className={s.art} viewBox="0 0 400 200" role="img" aria-label="Illustration: three PDF pages feed a record, and a citation line runs from the record back to one page.">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="24" y="26" width="76" height="100" rx="3" opacity="0.45" />
        <rect x="36" y="38" width="76" height="100" rx="3" opacity="0.7" />
        <rect x="48" y="50" width="76" height="100" rx="3" />
        <path d="M60 72h50M60 86h42M60 100h50M60 114h30" opacity="0.7" />
        <path d="M124 100h66" strokeDasharray="3 5" />
        <circle cx="250" cy="100" r="34" />
        <circle cx="250" cy="100" r="5" fill="currentColor" />
        <circle cx="318" cy="60" r="9" opacity="0.7" />
        <circle cx="328" cy="140" r="9" opacity="0.7" />
        <path d="M280 88l30-20M282 114l37 22" opacity="0.7" />
        <path d="M250 134c0 40-120 40-150 14" strokeDasharray="2 5" />
      </g>
      <rect x="56" y="93" width="54" height="10" rx="2" fill="currentColor" opacity="0.35" />
      <circle cx="108" cy="148" r="4" fill="currentColor" />
    </svg>
  );
}
