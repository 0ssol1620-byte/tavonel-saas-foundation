import Link from "next/link";
import type { Route } from "next";
import { activationPolicy } from "@/lib/activation-policy";
import { KO_CHROME } from "@/lib/site-navigation";
import {
  LANDING_V2_SCENE_ORDER,
  type LandingV2Locale,
  type LandingV2UseCopy,
} from "@/lib/landing-v2-copy";
import styles from "./use.module.css";

/*
  Scene 07 -- One way in. Every way out. (blueprint §17, contract rule 7.)

  The scene answers one question: once TAVONEL has compiled something, what can read it. §17
  draws that as a pipeline flowing from both sides into one hub, explicitly instead of a
  connector-logo wall -- and the logos are the part that could not be drawn even if it were the
  better design: the brand marks of Google, Dropbox and Microsoft are theirs, not ours, and a
  landing page is not a place to reproduce them. So every connector is a text label, which is
  also what the /integrations page itself publishes.

  WHAT IS COLOURED IS WHAT IS BUILT. `copy.inbound` / `copy.outbound` carry `built`, and a row
  with `built: false` renders monochrome. There are none today: every row below is a route this
  deployment publishes (/sources, /integrations, /docs/mcp, /docs/world-api, /docs/exports,
  /developers), and contract rule 7 forbids drawing a "planned" row that no page calls planned.
  The attribute is rendered anyway so that the day one arrives, the copy deck alone decides it.

  AND THE GATE IS STATED HERE, NOT TWO SCENES DOWN (QA round 4).
  Every row above is built; what is not open is permission to send your OWN files down any of
  them -- `activationPolicy.customerData.enabled` is false. The page this scene links to refuses
  to be written without saying so: `app/integrations/page.tsx` renders the same sentence in a
  notice, and the comment over it (G2-005) states the rule -- "a page that names five connectors
  in the present tense and leaves the gate to be discovered after a click is the shape the notice
  exists to prevent." Scene 07 was that shape: the landing's only statement of the gate was Scene
  09, two scenes and about two viewport-heights below, and the chrome deliberately no longer
  carries it. The strings are `activationPolicy.customerData.reason` and its one Korean
  translation in `KO_CHROME` -- the same two Scene 09 prints, so this is not a second spelling
  (contract rule 5).

  NO FIGURE REACHES THE PAGE FROM HERE. The scene states no count -- not the MCP tool count,
  not the export format count, not the number of connectors. `lib/mcp-tools.ts` exports
  `MCP_TOOL_COUNT_WORD` and the lane allowed printing it; it is left out because the sentence
  that would carry it ("nine read-only tools") has no literal Korean translation that is also
  digit-free, and a figure that appears on `/` and not on `/ko` is a claim published in one
  language. /docs/mcp states the count, from the same module, in its own summary.

  SERVER COMPONENT. Nothing here holds state: the pipeline is static SVG, the rows are links,
  and the only motion is a hover colour on a pointer device, which the sheet's reduced-motion
  block clamps with the rest.
*/

/**
 * The scene's one next action (§39), and the reason it is this route.
 *
 * `/docs/use-with-ai` is titled "Use your results with AI" in `lib/docs-content.ts`, which is
 * the page this label promises; `/developers` is titled "Developers" and is the distribution
 * page -- files, digests and the first API call. A reader who has just read "every way out"
 * wants the page that chooses between them, and that is the use-with-ai section: live access
 * over MCP/API, or the signed portable package. The scene's own rows already reach
 * `/developers` and the three docs sections directly.
 *
 * Exported so the composition wires the label from here rather than restating it, the way
 * `components/landing-v2/scene-actions.ts` holds every other scene's.
 */
export const USE_SCENE_ACTION: Record<LandingV2Locale, { label: string; href: string }> = {
  en: { label: "Use results with AI", href: "/docs/use-with-ai" },
  /* D12: a literal translation. 사용 is KO_TERMS' spelling of "use". */
  ko: { label: "결과를 AI에서 사용하기", href: "/docs/use-with-ai" },
};

/**
 * One intake or output row: the label is the link, the note is the sentence under it.
 *
 * `data-in` is what the accent hangs off. Blue is source/location in the semantic table (§5.2),
 * so the tick belongs to the intake side; an export is not a source and takes the neutral rule.
 */
function Row({ entry, inbound }: { entry: LandingV2UseCopy["inbound"][number]; inbound: boolean }) {
  return (
    <li className={styles.row} data-in={inbound ? "1" : "0"} data-built={entry.built ? "1" : "0"}>
      {/* Below the fold on every viewport this scene is reachable at (T1-014). */}
      <Link className={styles.rowLink} href={entry.href as Route} prefetch={false}>
        {entry.label}
      </Link>
      <p className={`${styles.rowNote} lv2-small`}>{entry.note}</p>
    </li>
  );
}

/*
  §17's drawing, in user units on one viewBox.

  The strand endpoints are the column centres of the lists above and below it -- three columns at
  1/6, 3/6, 5/6 of the width, four at 1/8, 3/8, 5/8, 7/8 -- so each strand actually points at the
  row it belongs to instead of being decorative curvature. That is also why the drawing and the
  multi-column lists share one breakpoint: at a single column there is nothing for a strand to
  point at.

  aria-hidden, because it carries no information the two lists do not already carry in text, and
  a screen reader reading out a fan of curves would be reading the layout rather than the scene.
*/
const WIDTH = 800;
const HEIGHT = 132;
const HUB_TOP = 52;
const HUB_BOTTOM = 80;
/** Rounded, because a path with sixteen decimal places is sixteen bytes of nothing per strand. */
const columnCentre = (index: number, columns: number) =>
  Math.round(((WIDTH * (index * 2 + 1)) / (columns * 2)) * 100) / 100;
const IN_X = [0, 1, 2].map((index) => columnCentre(index, 3));
const OUT_X = [0, 1, 2, 3].map((index) => columnCentre(index, 4));

function Pipeline() {
  return (
    <svg
      className={styles.pipe}
      /* The intrinsic size as well as the viewBox: the drawing reserves its own box before its
         stylesheet has said anything about it, rather than falling back to the SVG default. */
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      {IN_X.map((x) => (
        <path key={x} className={styles.strandIn} d={`M ${x} 0 C ${x} 30 ${WIDTH / 2} 22 ${WIDTH / 2} ${HUB_TOP}`} />
      ))}
      {OUT_X.map((x) => (
        <path
          key={x}
          className={styles.strandOut}
          d={`M ${WIDTH / 2} ${HUB_BOTTOM} C ${WIDTH / 2} ${HEIGHT - 22} ${x} ${HEIGHT - 30} ${x} ${HEIGHT}`}
        />
      ))}
      <rect className={styles.hub} x={WIDTH / 2 - 64} y={HUB_TOP} width={128} height={HUB_BOTTOM - HUB_TOP} rx={14} />
      <text className={styles.hubLabel} x={WIDTH / 2} y={HUB_TOP + 19} textAnchor="middle">
        TAVONEL
      </text>
    </svg>
  );
}

export default function Scene({ locale, copy }: { locale: LandingV2Locale; copy: LandingV2UseCopy }) {
  const titleId = "lv2-use-title";
  const inLabelId = "lv2-use-in";
  const outLabelId = "lv2-use-out";
  const action = USE_SCENE_ACTION[locale];

  return (
    <section
      id="use"
      data-scene={String(LANDING_V2_SCENE_ORDER.indexOf("use") + 1)}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="lv2-scene lv2-scene--proof lv2-obsidian"
    >
      <div className="lv2-wrap">
        <div className="lv2-split">
          <div className="lv2-scene-head">
            <p className="lv2-eyebrow lv2-meta">{copy.eyebrow}</p>
            <h2 className="lv2-h2" id={titleId}>
              <span className="lv2-h2-line">{copy.headline}</span>
              {copy.headlineAccent ? <span className="lv2-h2-line lv2-h2-accent">{copy.headlineAccent}</span> : null}
            </h2>
            <p className="lv2-scene-support lv2-body-l">{copy.support}</p>
            {copy.note ? <p className="lv2-scene-note lv2-small">{copy.note}</p> : null}
            {activationPolicy.customerData.enabled ? null : (
              <p className="lv2-scene-note lv2-small" data-customer-data="arranged">
                {locale === "ko" ? KO_CHROME.customerDataGate : activationPolicy.customerData.reason}
              </p>
            )}
            <Link className="lv2-text-link lv2-scene-next" href={action.href as Route} prefetch={false}>
              {action.label}
            </Link>
          </div>

          <div className={styles.lists}>
            <div className={styles.group}>
              <p className={`lv2-eyebrow lv2-meta ${styles.groupLabel}`} id={inLabelId}>
                {copy.inLabel}
              </p>
              <ul className={`${styles.rows} ${styles.inRows}`} aria-labelledby={inLabelId}>
                {copy.inbound.map((entry) => (
                  <Row key={entry.id} entry={entry} inbound />
                ))}
              </ul>
            </div>

            <Pipeline />

            <div className={styles.group}>
              <p className={`lv2-eyebrow lv2-meta ${styles.groupLabel}`} id={outLabelId}>
                {copy.outLabel}
              </p>
              <ul className={`${styles.rows} ${styles.outRows}`} aria-labelledby={outLabelId}>
                {copy.outbound.map((entry) => (
                  <Row key={entry.id} entry={entry} inbound={false} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
