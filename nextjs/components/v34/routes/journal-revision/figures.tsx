import s from "../journal/covers.module.css";

/** Revision A is compared with the later revision, and the difference goes to a decision. */
export function MethodFigure() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="Revision A is compared with the later revision, and the difference goes to a decision" xmlns="http://www.w3.org/2000/svg">
      {[30, 245, 460].map((x) => <rect key={x} className={s.sheet} x={x} y={112} width={150} height={96} rx={10} />)}
      <text className={s.label} x={105} y={168} textAnchor="middle">Revision A</text>
      <text className={s.label} x={320} y={168} textAnchor="middle">Diff</text>
      <text className={s.label} x={535} y={168} textAnchor="middle">Decision</text>
      <path className={s.line} d="M188 160H238M228 152L238 160L228 168" />
      <path className={s.line} d="M403 160H453M443 152L453 160L443 168" />
      <path className={s.dash} d="M105 112V70H535V112" />
      <text className={s.small} x={320} y={58} textAnchor="middle">Later revision</text>
    </svg>
  );
}
