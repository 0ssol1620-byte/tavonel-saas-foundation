import s from "../journal/covers.module.css";

/** A claim is checked against the method that produced it and the limitation that bounds it. */
export function MethodFigure() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="A claim is checked against its method and then bounded by its limitation" xmlns="http://www.w3.org/2000/svg">
      {[30, 245, 460].map((x) => <rect key={x} className={s.sheet} x={x} y={112} width={150} height={96} rx={10} />)}
      <text className={s.label} x={105} y={168} textAnchor="middle">Claim</text>
      <text className={s.label} x={320} y={168} textAnchor="middle">Method</text>
      <text className={s.small} x={535} y={158} textAnchor="middle">Limitation</text>
      <path className={s.line} d="M188 160H238M228 152L238 160L228 168" />
      <path className={s.line} d="M403 160H453M443 152L453 160L443 168" />
      <path className={s.dash} d="M105 208V250H535V208" />
      <text className={s.small} x={320} y={284} textAnchor="middle">Source passage</text>
    </svg>
  );
}
