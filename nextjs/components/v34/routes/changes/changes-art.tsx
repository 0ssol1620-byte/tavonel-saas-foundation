import s from "./changes.module.css";

/*
  The hero drawing of /changes, drawn for this page: two versions of a World as two columns of
  records, with the one thing that differs on each row marked by shape. Row one is the same on both
  sides, row two changed, row three left, row four arrived. Shapes only; the caption beside it says
  what it shows.
*/
const ROWS = [64, 112, 160, 208] as const;

export function ChangesArt({ label }: { label: string }) {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label={label} xmlns="http://www.w3.org/2000/svg">
      <rect className={s.artPanel} x="40" y="28" width="212" height="264" rx="6" />
      <rect className={s.artPanel} x="388" y="28" width="212" height="264" rx="6" />
      <rect className={s.artTitle} x="60" y="44" width="72" height="8" rx="2" />
      <rect className={s.artTitle} x="408" y="44" width="72" height="8" rx="2" />

      <rect className={s.artBar} x="60" y={ROWS[0]} width="172" height="32" rx="4" />
      <rect className={s.artBar} x="408" y={ROWS[0]} width="172" height="32" rx="4" />
      <path className={s.artRoute} d={`M232 ${ROWS[0] + 16} H 408`} />

      <rect className={s.artBar} x="60" y={ROWS[1]} width="172" height="32" rx="4" />
      <rect className={s.artChanged} x="408" y={ROWS[1]} width="172" height="32" rx="4" />
      <path className={s.artRoute} d={`M232 ${ROWS[1] + 16} H 408`} />

      <rect className={s.artGone} x="60" y={ROWS[2]} width="172" height="32" rx="4" />

      <rect className={s.artAdded} x="408" y={ROWS[3]} width="172" height="32" rx="4" />

      <circle className={s.artDot} cx="320" cy={ROWS[0] + 16} r="5" />
      <circle className={s.artDotChanged} cx="320" cy={ROWS[1] + 16} r="5" />
    </svg>
  );
}
