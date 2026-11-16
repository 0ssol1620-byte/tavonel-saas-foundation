import s from "./markets.module.css";

/** Drawn for this page: filings along a time axis, and a figure traced back to its filing. */
export function MarketsArt() {
  return (
    <svg className={s.art} viewBox="0 0 400 200" role="img" aria-label="Illustration: filings along a time axis, with a figure traced back to the filing that states it.">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M24 164h352" />
        <rect x="34" y="70" width="44" height="94" rx="3" />
        <rect x="102" y="104" width="44" height="60" rx="3" opacity="0.7" />
        <rect x="170" y="48" width="44" height="116" rx="3" opacity="0.7" />
        <rect x="238" y="112" width="44" height="52" rx="3" opacity="0.7" />
        <rect x="306" y="96" width="44" height="68" rx="3" opacity="0.7" />
        <path d="M46 92h20M46 104h14M46 116h20" opacity="0.7" />
        <rect x="184" y="28" width="116" height="26" rx="3" />
        <path d="M196 41h50" opacity="0.7" />
        <path d="M300 41c24 0 24 50-28 66" strokeDasharray="3 5" />
      </g>
      <rect x="46" y="100" width="20" height="8" rx="2" fill="currentColor" opacity="0.4" />
      <circle cx="252" cy="108" r="4" fill="currentColor" />
    </svg>
  );
}
