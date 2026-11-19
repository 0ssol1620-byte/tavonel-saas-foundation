import s from "./teams.module.css";

/** Drawn for this page: three readers around one World, each with a line to the same source page. */
export function TeamsArt() {
  return (
    <svg className={s.art} viewBox="0 0 400 200" role="img" aria-label="Illustration: readers around one World, each with a line running to the same source page.">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="200" cy="100" r="30" />
        <circle cx="200" cy="100" r="5" fill="currentColor" />
        <circle cx="86" cy="52" r="14" opacity="0.7" />
        <circle cx="86" cy="148" r="14" opacity="0.7" />
        <circle cx="314" cy="52" r="14" opacity="0.7" />
        <path d="M98 60l78 28M98 140l78-28M302 60l-78 28" opacity="0.7" />
        <rect x="290" y="116" width="60" height="56" rx="3" />
        <path d="M302 134h36M302 148h26" opacity="0.7" />
        <path d="M228 114c20 8 36 12 62 12" strokeDasharray="3 5" />
      </g>
      <circle cx="290" cy="126" r="4" fill="currentColor" />
    </svg>
  );
}
