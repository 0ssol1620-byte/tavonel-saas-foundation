import s from "./engineering.module.css";

/** Drawn for this page: two revisions of a document, one changed line, and its citation to a page. */
export function EngineeringArt() {
  return (
    <svg className={s.art} viewBox="0 0 400 200" role="img" aria-label="Illustration: an earlier and a later revision of a standard side by side, a changed requirement marked, and a citation line running to the page that states it.">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="28" y="28" width="104" height="132" rx="3" opacity="0.7" />
        <path d="M44 52h72M44 68h58M44 84h72M44 100h50M44 116h66M44 132h40" opacity="0.7" />
        <rect x="168" y="28" width="104" height="132" rx="3" />
        <path d="M184 52h72M184 68h58M184 100h50M184 116h66M184 132h40" opacity="0.7" />
        <path d="M184 84h72" strokeWidth="2.5" />
        <path d="M132 84h36" strokeDasharray="3 5" />
        <rect x="308" y="60" width="64" height="80" rx="3" />
        <path d="M320 80h40M320 96h30M320 112h40" opacity="0.7" />
        <path d="M272 84c16 0 20 16 36 16" strokeDasharray="3 5" />
      </g>
      <rect x="184" y="80" width="72" height="8" rx="2" fill="currentColor" opacity="0.35" />
      <circle cx="308" cy="100" r="4" fill="currentColor" />
    </svg>
  );
}
