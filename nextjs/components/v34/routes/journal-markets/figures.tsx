import s from "../journal/covers.module.css";

/** A cutoff splits the releases a question may use from the later ones it may not. */
export function Cover() {
  const known = [96, 190, 284] as const;
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="A cutoff date separates the releases a question may use from the later releases" xmlns="http://www.w3.org/2000/svg">
      <path className={s.line} d="M40 190H600" />
      {known.map((x) => <circle key={x} className={s.node} cx={x} cy={190} r={10} />)}
      {[470, 548].map((x) => <circle key={x} className={s.sheet} cx={x} cy={190} r={10} />)}
      <path className={s.dash} d="M376 80V260" />
      <text className={s.label} x={376} y={64} textAnchor="middle">As-of cutoff</text>
      <text className={s.small} x={190} y={236} textAnchor="middle">Releases in scope</text>
      <text className={s.small} x={509} y={236} textAnchor="middle">Later releases</text>
    </svg>
  );
}

/** A release, then the cutoff, then the data that arrives after it. */
export function MethodFigure() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="A release comes before the cutoff, and later data stays outside the question" xmlns="http://www.w3.org/2000/svg">
      {[30, 245, 460].map((x) => <rect key={x} className={s.sheet} x={x} y={112} width={150} height={96} rx={10} />)}
      <text className={s.label} x={105} y={168} textAnchor="middle">Release</text>
      <text className={s.label} x={320} y={168} textAnchor="middle">Cutoff</text>
      <text className={s.small} x={535} y={168} textAnchor="middle">Later data</text>
      <path className={s.line} d="M188 160H238M228 152L238 160L228 168" />
      <path className={s.dash} d="M403 160H453" />
    </svg>
  );
}
