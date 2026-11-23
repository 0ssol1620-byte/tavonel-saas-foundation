import s from "./evidence.module.css";

/*
  The hero drawing of /evidence, drawn for this page: a source page with one highlighted region, and
  a line from that region to the claim that cites it, with the page's hash, region and version as three
  small links of a chain under it. Shapes only; the caption beside it says what it shows.
*/
/** [y, width] of each line of text on the page. */
const LINES = [[58, 192], [82, 170], [106, 192], [130, 150], [178, 192], [202, 170], [226, 192], [250, 120]] as const;

export function EvidenceArt({ label }: { label: string }) {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label={label} xmlns="http://www.w3.org/2000/svg">
      <rect className={s.artPage} x="40" y="24" width="236" height="272" rx="4" />
      <rect className={s.artTitle} x="62" y="40" width="96" height="8" rx="2" />
      {LINES.map(([y, width]) => (
        <rect key={y} className={s.artLine} x="62" y={y} width={width} height="8" rx="2" />
      ))}
      <rect className={s.artHit} x="54" y="146" width="208" height="20" rx="3" />
      <path className={s.artRoute} d="M262 156 C 330 156 330 96 394 96" />
      <circle className={s.artDot} cx="262" cy="156" r="5" />
      <rect className={s.artCard} x="394" y="40" width="206" height="112" rx="6" />
      <rect className={s.artCardTitle} x="414" y="62" width="120" height="10" rx="2" />
      <rect className={s.artCardLine} x="414" y="88" width="166" height="8" rx="2" />
      <rect className={s.artCardLine} x="414" y="108" width="150" height="8" rx="2" />
      <rect className={s.artCardLine} x="414" y="128" width="92" height="8" rx="2" />
      <path className={s.artChain} d="M430 196 H 470 M 534 196 H 574" />
      <rect className={s.artChip} x="394" y="178" width="36" height="36" rx="6" />
      <rect className={s.artChip} x="470" y="178" width="64" height="36" rx="6" />
      <rect className={s.artChip} x="574" y="178" width="26" height="36" rx="6" />
      <path className={s.artRoute} d="M497 152 V 178" />
      <rect className={s.artChainBar} x="394" y="240" width="206" height="8" rx="2" />
      <rect className={s.artChainBar} x="394" y="262" width="140" height="8" rx="2" />
    </svg>
  );
}
