import type { ArenaBar, ArenaDot, ArenaModel } from "@/lib/model-arena-page-data";
import styles from "./arena-charts.module.css";

/*
  The Model Arena charts. Server-rendered SVG, no chart library, no client JavaScript.

  Why they are built this way rather than with a charting dependency:

  - A chart library ships a runtime to draw ten rectangles, and every one of them animates on
    mount by default. Motion here would encode nothing (AGENTS.md: decorative animation is not
    shipped), and a reader with `prefers-reduced-motion` would be opting out of a transition that
    should never have existed. There is no animation in this file, so there is nothing to disable.
  - The marks are SVG and the words are HTML. Text inside a scaled `viewBox` grows and shrinks
    with the viewport, which is how a 12px label becomes 6px on a phone. Labels, values and
    denominators are ordinary text in the row, so they keep the page's type scale at every width.
  - The bar's own geometry is the figure's share of the chart maximum, computed in
    `lib/model-arena-page-data.ts` and nowhere else. Nothing here rounds a value before drawing it.

  Direction is never encoded in colour or in bar length. Edit distance is lower-better and TEDS is
  higher-better; a chart that quietly inverted one of them would draw the better model shorter.
  Both draw proportional to the figure, and the caption states which direction is better.
*/

const dp = (value: number, places = 4) => value.toFixed(places);

/**
 * One measured figure per model, as a proportional bar.
 *
 * `max` is the chart's own largest value, not 1.0, and it is printed in the scale line: every
 * text Edit on this board is under 0.18, so a 0..1 axis would draw ten bars of the same apparent
 * length. The page count sits under the axis because it is the denominator every bar was scored
 * over, and two bars scored over different page counts are not the same measurement.
 */
export function ArenaBarChart({
  title,
  direction,
  bars,
  unit,
}: {
  title: string;
  /** Stated, never drawn: which way is better on this metric. */
  direction: string;
  bars: readonly ArenaBar[];
  unit: string;
}) {
  const max = Math.max(...bars.map((bar) => bar.value));
  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartHead}>
        <h3>{title}</h3>
        <p>
          {direction} · {unit} · bars are drawn to the largest figure on this chart,{" "}
          <span data-derived="1">{dp(max)}</span>, not to 1.0.
        </p>
      </figcaption>
      <ol className={styles.bars}>
        {bars.map((bar) => (
          <li className={styles.bar} key={bar.key}>
            <span className={styles.barLabel}>{bar.label}</span>
            {/*
              The mark. `preserveAspectRatio="none"` is correct here and only here: the rect has
              no aspect to preserve, so the bar stretches to the row's width and its length stays
              exactly `fraction` of it at every viewport.
            */}
            <svg
              className={styles.barTrack}
              viewBox="0 0 100 8"
              preserveAspectRatio="none"
              role="presentation"
              aria-hidden="true"
              focusable="false"
            >
              <rect x="0" y="0" width="100" height="8" className={styles.barGround} />
              <rect x="0" y="0" width={bar.fraction * 100} height="8" className={styles.barFill} />
            </svg>
            <span className={styles.barValue} data-derived="1">{dp(bar.value)}</span>
            <span className={styles.barPages} data-derived="1">
              {bar.pages.toLocaleString("en-US")} pages
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/*
  The plot's own coordinate space. It is a fixed user-unit box inside a horizontal-scroll frame,
  rather than a box that scales to the viewport, for the reason the header note gives: the axis
  ticks are text, and text in a scaled viewBox is 6px on a phone and 20px on a desktop. The frame
  scrolls at 360px the same way the tables do, and the list under the plot carries every value as
  text, so nothing is only available by scrolling.
*/
const PLOT = { width: 560, height: 320, left: 54, right: 16, top: 18, bottom: 44 } as const;

/**
 * Speed against quality, one dot per model that has both readings.
 *
 * A model missing from either board is not plotted. There is no imputed position and no dot at
 * zero: the rows that could not be plotted are named underneath with the campaign's own reason.
 *
 * Both axes are logarithmic in neither direction and linear in both, because both quantities are
 * linear; the x axis runs over median seconds per page, which spans 3 to 29 on this board, and
 * the y axis over text Edit. Lower is better on both, so the best corner is the bottom left, and
 * the caption says so rather than an arrow implying it.
 */
export function ArenaSpeedQualityPlot({ dots }: { dots: readonly ArenaDot[] }) {
  const maxSeconds = Math.max(...dots.map((dot) => dot.secondsPerPage));
  const maxEdit = Math.max(...dots.map((dot) => dot.textEdit));
  const plotW = PLOT.width - PLOT.left - PLOT.right;
  const plotH = PLOT.height - PLOT.top - PLOT.bottom;
  const x = (seconds: number) => PLOT.left + (seconds / maxSeconds) * plotW;
  const y = (edit: number) => PLOT.top + (edit / maxEdit) * plotH;

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartHead}>
        <h3>Median seconds per page against text Edit distance</h3>
        <p>
          Lower is better on both axes, so the bottom-left corner is the cheapest reading per page
          at the closest match to the benchmark&rsquo;s ground truth. Every dot is one model on the
          same corpus, the same evaluator revision and the same scoring driver.
        </p>
      </figcaption>
      <div className={styles.plotScroll}>
        <svg
          className={styles.plot}
          viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
          role="img"
          aria-label={`Scatter plot of ${dots.length} models: median seconds per page on the horizontal axis, OmniDocBench text Edit distance on the vertical axis. Lower is better on both.`}
        >
          <line
            className={styles.axis}
            x1={PLOT.left} y1={PLOT.top} x2={PLOT.left} y2={PLOT.height - PLOT.bottom}
          />
          <line
            className={styles.axis}
            x1={PLOT.left} y1={PLOT.height - PLOT.bottom}
            x2={PLOT.width - PLOT.right} y2={PLOT.height - PLOT.bottom}
          />
          {dots.map((dot) => (
            <g key={dot.key}>
              <circle className={styles.dot} cx={x(dot.secondsPerPage)} cy={y(dot.textEdit)} r="4.5">
                <title>
                  {`${dot.label}: ${dot.secondsPerPage} s/page (median over ${dot.timedPages.toLocaleString("en-US")} timed pages), text Edit ${dp(dot.textEdit)} over ${dot.pages.toLocaleString("en-US")} pages`}
                </title>
              </circle>
            </g>
          ))}
          <text className={styles.tick} x={PLOT.left} y={PLOT.height - PLOT.bottom + 16}>0</text>
          <text
            className={styles.tick}
            x={PLOT.width - PLOT.right}
            y={PLOT.height - PLOT.bottom + 16}
            textAnchor="end"
          >
            {maxSeconds} s/page
          </text>
          <text className={styles.tick} x={PLOT.left - 8} y={PLOT.top + 4} textAnchor="end">
            {dp(maxEdit)}
          </text>
          <text
            className={styles.tick}
            x={PLOT.left - 8}
            y={PLOT.height - PLOT.bottom}
            textAnchor="end"
          >
            0
          </text>
        </svg>
      </div>
      {/*
        The same readings as text, in the plot's order, because a mark a reader cannot name is
        not evidence. This is also the whole content of the plot for a screen reader and for a
        printed page.
      */}
      <ol className={styles.dotKey}>
        {dots.map((dot) => (
          <li key={dot.key}>
            <b>{dot.label}</b>{" "}
            <span data-derived="1">
              {dot.secondsPerPage} s/page ({dot.pagesPerHour.toLocaleString("en-US")} pages/h serial,
              median over {dot.timedPages.toLocaleString("en-US")} timed pages) · text Edit{" "}
              {dp(dot.textEdit)} over {dot.pages.toLocaleString("en-US")} pages
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/**
 * The receipts drawer: what each row was, on what hardware, at what listed rate, and the digest
 * of every file the artifact was assembled from.
 *
 * Folded rather than deleted. A reader who wants a chart should not have to read a table of
 * container digests to reach it, and a reader who wants to check the chart should not have to
 * ask us for the digests. The GPU rate is the rate the provider listed when the pod was
 * provisioned; it is not a price for a page, and no price per page is computed anywhere on this
 * page from it.
 */
export function ArenaReceipts({
  models,
  sources,
}: {
  models: readonly ArenaModel[];
  sources: readonly Readonly<{ path: string; sha256: string }>[];
}) {
  return (
    <details className="status-fold">
      <summary>Receipts: model identity, hardware, and the digest of every source</summary>
      <div className={styles.tableScroll}>
        <table className={styles.receipts}>
          <caption>
            Identity and hardware per row. A blank cell is a value the campaign did not record;
            it is never filled from another row.
          </caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Weights or hosted id</th>
              <th scope="col">Revision</th>
              <th scope="col">Licence</th>
              <th scope="col">GPU</th>
              <th scope="col">Listed rate</th>
              <th scope="col">Price snapshot</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.key}>
                <th scope="row">
                  {model.display_name}
                  <em>{model.key}</em>
                </th>
                <td className={styles.digest}>
                  {model.identity.weights_repository ?? model.identity.api_model_id ?? "—"}
                </td>
                <td className={styles.digest} data-derived="1">
                  {model.identity.weights_revision ?? "—"}
                </td>
                <td>{model.identity.license}</td>
                <td>{model.gpu.gpu_type ?? "—"}</td>
                <td data-derived="1">
                  {model.gpu.listed_usd_per_hour === null
                    ? "—"
                    : `$${model.gpu.listed_usd_per_hour.toFixed(2)}/h listed`}
                </td>
                <td className={styles.digest} data-derived="1">
                  {model.gpu.price_snapshot_sha256 ?? model.gpu.absent_reason ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.receipts}>
          <caption>
            The campaign files this board was assembled from, and the sha256 of the bytes the
            build read. A source that is not on the build machine stops the build.
          </caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">sha256</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.path}>
                <th scope="row" className={styles.digest}>{source.path}</th>
                <td className={styles.digest} data-derived="1">{source.sha256}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
