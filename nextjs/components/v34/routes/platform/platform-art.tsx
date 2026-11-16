import s from "./platform.module.css";

/*
  The platform illustration: pages on the left, the compile step in the middle, a small World on the
  right, and a dashed line that carries one record back to the region it was read from. Every
  colour is a token in the sheet; the numbers here are drawing coordinates, not figures.
*/
export function PlatformArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="Pages are read into a compile step, the compile step produces a World of linked records, and a dashed line returns from one record to the region it came from">
      <rect className={s.page} x="40" y="70" width="84" height="104" rx="3" />
      <rect className={s.page} x="56" y="86" width="84" height="104" rx="3" />
      <rect className={s.page} x="72" y="102" width="84" height="104" rx="3" />
      <path className={s.line} d="M84 122H144M84 136H136M84 150H144M84 164H128" />
      <rect className={s.region} x="80" y="170" width="68" height="28" rx="2" />
      <path className={s.line} d="M88 180H140M88 190H128" />

      <path className={s.edge} d="M156 154H246" />
      <path className={s.head} d="M246 148L256 154L246 160Z" />
      <rect className={s.block} x="258" y="96" width="124" height="128" rx="4" />
      <rect className={s.bar} x="274" y="114" width="92" height="14" rx="2" />
      <rect className={s.bar} x="274" y="140" width="92" height="14" rx="2" />
      <rect className={s.bar} x="274" y="166" width="92" height="14" rx="2" />
      <rect className={s.barOn} x="274" y="192" width="92" height="14" rx="2" />
      <path className={s.edge} d="M382 160H432" />
      <path className={s.head} d="M432 154L442 160L432 166Z" />

      <path className={s.edge} d="M470 96L546 84M470 96L514 160M546 84L592 176M514 160L592 176M514 160L476 232M476 232L562 248M592 176L562 248" />
      <circle className={s.node} cx="470" cy="96" r="7" />
      <circle className={s.node} cx="546" cy="84" r="7" />
      <circle className={s.node} cx="514" cy="160" r="7" />
      <circle className={s.node} cx="592" cy="176" r="7" />
      <circle className={s.nodeOn} cx="476" cy="232" r="9" />
      <circle className={s.node} cx="562" cy="248" r="7" />

      <path className={s.evidence} d="M476 241V272H114V204" />
      <path className={s.headOn} d="M108 206L114 196L120 206Z" />

      <text className={s.label} x="114" y="306" textAnchor="middle">Pages</text>
      <text className={s.label} x="320" y="306" textAnchor="middle">Compile</text>
      <text className={s.label} x="528" y="306" textAnchor="middle">World</text>
    </svg>
  );
}
