import s from "./film.module.css";

/** A film strip of three frames: a source sheet, a record with its region, a cited answer. */
export function FilmArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="A strip of storyboard frames: a source file, a record with its evidence region, and a cited answer" xmlns="http://www.w3.org/2000/svg">
      {[30, 245, 460].map((x) => <rect key={x} className={s.sheet} x={x} y={72} width={150} height={150} rx={10} />)}
      <path className={s.line} d="M188 147H238M228 139L238 147L228 155" />
      <path className={s.line} d="M403 147H453M443 139L453 147L443 155" />
      <path className={s.line} d="M56 110H154M56 130H154M56 150H124" />
      <rect className={s.line} x={271} y={112} width={98} height={34} rx={6} />
      <path className={s.line} d="M271 170H369M271 190H339" />
      <circle className={s.node} cx={496} cy={112} r={9} />
      <path className={s.line} d="M486 150H584M486 170H560" />
      <circle className={s.node} cx={496} cy={196} r={6} />
      <text className={s.label} x={105} y={266} textAnchor="middle">Source</text>
      <text className={s.label} x={320} y={266} textAnchor="middle">Evidence</text>
      <text className={s.label} x={535} y={266} textAnchor="middle">Answer</text>
    </svg>
  );
}
