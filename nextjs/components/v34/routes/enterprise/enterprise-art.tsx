import s from "./enterprise.module.css";

/**
 * The drawing for /enterprise: a source page with one region marked, the candidate compiled from
 * it, the reviewer's decision between the two, and the active World that results. Drawn for this
 * page only; colours are the V34 tokens through the sheet.
 */
export function EnterpriseArt() {
  return (
    <svg className={s.art} viewBox="0 0 640 320" role="img" aria-label="A source page with one marked region becomes a candidate, a reviewer approves it, and it becomes the active World." xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0 24)">
      {/* source: a page behind a page, one region marked */}
      <rect className={s.sheetBack} x="52" y="62" width="104" height="140" rx="4" />
      <rect className={s.sheet} x="40" y="50" width="104" height="140" rx="4" />
      <path className={s.rule} d="M56 78h72M56 96h56M56 148h72M56 166h40" />
      <rect className={s.region} x="54" y="108" width="76" height="26" rx="2" />
      <text className={s.lab} x="92" y="244" textAnchor="middle">Source</text>

      <path className={s.arrow} d="M158 120h36m-8 -6l8 6l-8 6" />

      {/* candidate: rows, one of them changed */}
      <rect className={s.panel} x="206" y="50" width="124" height="140" rx="6" />
      <path className={s.rule} d="M224 80h88M224 150h88" />
      <path className={s.mark} d="M224 114h88" />
      <text className={s.lab} x="268" y="244" textAnchor="middle">Candidate</text>

      <path className={s.arrow} d="M332 120h22m-8 -6l8 6l-8 6" />

      {/* the decision */}
      <circle className={s.gate} cx="386" cy="120" r="22" />
      <path className={s.tick} d="M376 120l7 8l14 -16" />
      <text className={s.lab} x="386" y="244" textAnchor="middle">Reviewer</text>

      <path className={s.arrow} d="M414 120h22m-8 -6l8 6l-8 6" />

      {/* active World: a few records and their links */}
      <rect className={s.panelActive} x="446" y="50" width="156" height="140" rx="6" />
      <path className={s.edge} d="M486 90L540 80M540 80L572 128M486 90L504 150M504 150L572 128M540 80L504 150" />
      <circle className={s.node} cx="486" cy="90" r="9" />
      <circle className={s.node} cx="540" cy="80" r="9" />
      <circle className={s.nodeActive} cx="572" cy="128" r="9" />
      <circle className={s.node} cx="504" cy="150" r="9" />
      <text className={s.lab} x="524" y="244" textAnchor="middle">Active World</text>
      </g>
    </svg>
  );
}
