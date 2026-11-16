import s from "./solutions.module.css";

/*
  The drawing for /solutions: source documents on the left, one World in the middle, the people and
  tools that read it on the right. Shapes only, no text, so nothing in it can fall below the type
  floor at a narrow width; the meaning is in the figure's label and its caption.
*/
export function SolutionsArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="Source documents feed one World, which several readers draw from" xmlns="http://www.w3.org/2000/svg">
      <g>
        <rect className={s.sheet} x="44" y="62" width="96" height="124" rx="6" />
        <rect className={s.sheet} x="60" y="86" width="96" height="124" rx="6" />
        <rect className={s.sheet} x="76" y="110" width="96" height="124" rx="6" />
        <path className={s.bar} d="M94 138H152M94 156H152M94 174H132" />
        <path className={s.feed} d="M172 172H282" />
      </g>
      <g>
        <path className={s.edge} d="M320 160L266 94M320 160L398 104M320 160L404 226M320 160L252 232M266 94L398 104M404 226L252 232" />
        <circle className={s.ring} cx="320" cy="160" r="28" />
        <circle className={s.hub} cx="320" cy="160" r="10" />
        <circle className={s.node} cx="266" cy="94" r="8" />
        <circle className={s.node} cx="398" cy="104" r="8" />
        <circle className={s.node} cx="404" cy="226" r="8" />
        <circle className={s.node} cx="252" cy="232" r="8" />
      </g>
      <g>
        <path className={s.feed} d="M348 160H492M404 104L492 96M404 226L492 224" />
        <rect className={s.reader} x="492" y="68" width="104" height="56" rx="6" />
        <rect className={s.reader} x="492" y="132" width="104" height="56" rx="6" />
        <rect className={s.reader} x="492" y="196" width="104" height="56" rx="6" />
        <path className={s.bar} d="M508 88H576M508 104H552M508 152H576M508 168H552M508 216H576M508 232H552" />
      </g>
    </svg>
  );
}
