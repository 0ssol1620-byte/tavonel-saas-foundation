import type { CSSProperties } from "react";
import { capabilityTokenLabel } from "../../../shared/capabilityManifest";
import { meets, SPECIMEN_LIMIT_LABEL_KO, type Specimen, type SpecimenSlot } from "@/lib/specimen-sources";
import styles from "./specimen-strip.module.css";

/*
  P2-08 / UX-L4 (UX-PLAN-2026-10-17 §3.1-§3.4): real pages read by the reader, each beside the
  text the reader returned for one region of it.

  What a cell shows, top to bottom: what kind of page it is; the region's page and coordinates; a
  window of the source page with the reader's region outlined inside it; the reader's text for that
  region, as returned; a short source line; and the run it came from. The text is printed as one
  text node under `white-space: pre-wrap`, so what the page holds is the receipt's `extractedText`
  byte for byte. The table cell carries the manifest's own limitation label, because the reader
  returns a table's lines and never its cells (critic V21).

  NO SCRIPT. A server component with no client island: from 1024px the cells sit side by side; below
  it they share one grid area, and a native radio group picks the visible one. The radios give the
  arrow keys and the single tab stop that `scenes/proof-tabs.tsx` writes by hand, and the hidden
  cells keep their boxes (`visibility`), so the area is always the tallest cell's and switching
  moves nothing below it. "Show full text" is a `<details>` toggle. Nothing here adds to the §22
  script budget, rendered or not.

  Renders nothing without a cell: `homeSpecimens` refuses every incomplete receipt, and renders
  the committed ones only where the rollout switch allows (lib/specimen-sources.ts).

  P2-32 (D-06): beside each crop, the short source line and its link; the approved full line
  (SPECIMEN-CANDIDATES §4.4, the KOGL sentence on /ko) opens with "Show full text". Each image is
  offered as AVIF at 720 and 960 px first; the WEBP is the fallback. CROP_SIZES is the cell: the
  content width on a phone, at most half the row from 1024 px.

  hard-proof 2026-10-27 (FINAL-SPEC-HARD-PROOF §2): the strip sits at the end of s2, below the
  fold, so every image in it loads lazily and none asks for priority -- the film poster in s1 is
  the first screen's priority image in every posture. Above the crop, each production cell shows
  the whole page with every region the reader returned drawn over it as inline SVG (the chosen one
  heavier), the boxes the receipt keeps off Home dashed where they were painted out, and a count
  line "N regions · T s" read from the receipt. A slot may hold several cells; when it does, each
  tab adds its cell's page so the names differ.

  PR #174 review round 1 (B1-B4): a cell reads top to bottom as one mono line of what the run was
  (page · regions · seconds · receipt), the whole page, the crop and its source, then the label
  "Reader output, unedited" directly above the output, the manifest's limit under it where the cell
  has one, then "Show full text"; the region's stored
  coordinates moved under that toggle. What the page view paints out is hatched -- the box and every
  region the reader returned inside it -- and named under the page from the receipt's own legend.
  Phone tabs use short names at their content width on one line, the hero's tab grammar. /ko prints
  the limits and the receipt link in Korean.
*/

const CROP_SIZES = "(min-width: 1024px) 50vw, calc(100vw - 32px)";

const COPY = {
  en: {
    strip: "Pages read by the reader",
    choose: "Specimen page",
    kind: { drawing: "Schematic page", degraded_scan: "Scanned page", table: "Table page", korean: "Korean document" } satisfies Record<SpecimenSlot, string>,
    tab: { drawing: "Drawing", degraded_scan: "Scan", table: "Table", korean: "Korean" } satisfies Record<SpecimenSlot, string>,
    synthetic: "synthetic fixture",
    source: "Source",
    unedited: "Reader output, unedited",
    receipt: "receipt",
    box: "Region",
    more: "Show full text",
    less: "Show less",
    crop: (kind: string) => `${kind}: the window around the region the reader read`,
    page: (kind: string) => `${kind}: the whole page, every region the reader returned outlined`,
    count: (regions: number, seconds: number) => `${regions} regions · ${seconds} s`,
    painted: (what: string) => `Hatched: painted out (${what})`,
    limit: capabilityTokenLabel,
  },
  ko: {
    strip: "판독기가 읽은 페이지",
    choose: "표본 페이지",
    kind: { drawing: "회로도 페이지", degraded_scan: "스캔한 페이지", table: "표가 있는 페이지", korean: "한국어 문서" } satisfies Record<SpecimenSlot, string>,
    tab: { drawing: "회로도", degraded_scan: "스캔", table: "표", korean: "한국어" } satisfies Record<SpecimenSlot, string>,
    synthetic: "합성 픽스처",
    source: "출처",
    unedited: "판독기 출력, 수정 없음",
    receipt: "기록",
    box: "영역",
    more: "전체 보기",
    less: "접기",
    crop: (kind: string) => `${kind}: 판독기가 읽은 영역을 둘러싼 부분`,
    page: (kind: string) => `${kind}: 판독기가 반환한 모든 영역을 표시한 페이지 전체`,
    count: (regions: number, seconds: number) => `영역 ${regions}개 · ${seconds}초`,
    painted: (what: string) => `빗금: 지운 부분(${what})`,
    // specimenProblem refuses a token without a Korean label, so this never prints undefined.
    limit: (token: string) => SPECIMEN_LIMIT_LABEL_KO[token]!,
  },
};

/** One hatch for every painted-out box, defined once in the strip and referenced by each page's SVG. */
const HATCH = "specimen-hatch";

/** The region's place inside the crop, as percentages of the crop's box. */
function outline({ region, crop }: Specimen): CSSProperties {
  const [x0, y0, x1, y1] = crop.window1000;
  const [r0, s0, r1, s1] = region.bbox1000;
  const pct = (value: number) => `${(value * 100).toFixed(3)}%`;
  return {
    left: pct((r0 - x0) / (x1 - x0)),
    top: pct((s0 - y0) / (y1 - y0)),
    width: pct((r1 - r0) / (x1 - x0)),
    height: pct((s1 - s0) / (y1 - y0)),
  };
}

/** A box in the page's 1000-unit space, as SVG rect attributes. */
const rect = ([x0, y0, x1, y1]: readonly number[]) => ({ x: x0, y: y0, width: x1! - x0!, height: y1! - y0! });

export default function SpecimenStrip({ specimens, korean = false }: { specimens: readonly Specimen[]; korean?: boolean }) {
  if (specimens.length === 0) return null;
  const copy = COPY[korean ? "ko" : "en"];
  const repeated = (slot: SpecimenSlot) => specimens.filter(cell => cell.slot === slot).length > 1;
  return (
    <div className={styles.strip} role="region" aria-label={copy.strip} data-specimen-strip="" data-cells={specimens.length}>
      {specimens.some(specimen => specimen.fullPage) ? (
        // Not display:none: a pattern under a display:none SVG paints nothing in Chromium and Gecko.
        <svg className={styles.defs} width="0" height="0" aria-hidden="true" focusable="false">
          <defs>
            <pattern id={HATCH} patternUnits="userSpaceOnUse" width="24" height="24">
              <path className={styles.hatch} d="M-6,6 L6,-6 M0,24 L24,0 M18,30 L30,18" />
            </pattern>
          </defs>
        </svg>
      ) : null}
      {specimens.length > 1 ? (
        <div className={styles.tabs} role="radiogroup" aria-label={copy.choose}>
          {specimens.map((specimen, index) => (
            <label className={styles.tab} key={specimen.specimenId}>
              <input type="radio" name="specimen-page" value={specimen.specimenId} defaultChecked={index === 0} data-specimen-tab="" />
              {copy.tab[specimen.slot]}
              {repeated(specimen.slot) ? <span data-derived="1">{` · p.${specimen.page}`}</span> : null}
            </label>
          ))}
        </div>
      ) : null}
      <ol className={styles.cells}>
        {specimens.map(specimen => {
          const caption = specimen.caption[korean ? "ko" : "en"];
          // UX §3.4-2: the coordinates as stored; under "Show full text" since PR #174 review B3.
          const [r0, s0, r1, s1] = specimen.region.bbox1000;
          const [x0, y0, x1, y1] = specimen.crop.window1000;
          const page = specimen.fullPage;
          const painted = specimen.avoidInCrop.map(item => item.legend?.[korean ? "ko" : "en"]).filter(Boolean).join(", ");
          return (
            <li className={styles.cell} key={specimen.specimenId} data-specimen-cell={specimen.specimenId} data-slot={specimen.slot}>
              <p className={styles.kind}>
                {copy.kind[specimen.slot]}
                {specimen.synthetic ? <span> · {copy.synthetic}</span> : null}
              </p>
              <p className={styles.meta} data-derived="1" data-specimen-meta="">
                {`p.${specimen.page} · `}
                {page ? <><span className={styles.count} data-specimen-count="">{copy.count(page.regions.length, page.seconds)}</span>{" · "}</> : null}
                <a href={specimen.runReceiptUrl} rel="noopener noreferrer" data-specimen-receipt="">{copy.receipt}</a>
              </p>
              {page ? (
                <figure className={styles.page} data-specimen-page="">
                  <div className={styles.frame}>
                    {/* Plain <picture>, as for the crop: the receipt's own bytes, never re-encoded by an optimizer. */}
                    <picture>
                      <source type="image/avif" sizes={CROP_SIZES}
                        srcSet={page.sources.map(source => `${source.path} ${source.width}w`).join(", ")} />
                      <img src={page.path} width={page.width} height={page.height}
                        alt={copy.page(copy.kind[specimen.slot])} decoding="async" loading="lazy" />
                    </picture>
                    {/* bbox1000 is the page's own 0-1000 space on both axes, so the SVG stretches with the image. */}
                    <svg className={styles.regions} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                      {/* The painted-out boxes first, hatched; a region the reader returned inside one is hatched with it. */}
                      {specimen.avoidInCrop.map((item, index) => (
                        <rect key={index} {...rect(item.bbox1000)} fill={`url(#${HATCH})`} data-masked="" />
                      ))}
                      {page.regions.map(region => {
                        const masked = specimen.avoidInCrop.some(item => meets(region.bbox1000, item.bbox1000));
                        return (
                          <rect key={region.regionId} {...rect(region.bbox1000)} vectorEffect="non-scaling-stroke" data-region={region.regionId}
                            fill={masked ? `url(#${HATCH})` : undefined} data-under-mask={masked ? "" : undefined}
                            data-selected={region.regionId === specimen.region.regionId ? "" : undefined} />
                        );
                      })}
                    </svg>
                  </div>
                  {painted ? <figcaption className={styles.legend} data-specimen-legend="">{copy.painted(painted)}</figcaption> : null}
                </figure>
              ) : null}
              <figure className={styles.crop} data-specimen-crop="" data-crop-window={`${x0},${y0},${x1},${y1}`}>
                <div className={styles.frame}>
                  {/* Plain <picture>, not next/image: a fixed crop with its receipt's own size; no optimizer may re-encode source pixels (specimen §4.5). */}
                  <picture>
                    {specimen.crop.sources?.length ? (
                      <source type="image/avif" sizes={CROP_SIZES}
                        srcSet={specimen.crop.sources.map(source => `${source.path} ${source.width}w`).join(", ")} />
                    ) : null}
                    <img src={specimen.cropSrc} width={specimen.crop.width} height={specimen.crop.height}
                      alt={copy.crop(copy.kind[specimen.slot])} decoding="async" loading="lazy" />
                  </picture>
                  <span className={styles.region} style={outline(specimen)} data-specimen-region={specimen.region.regionId} aria-hidden="true" />
                </div>
                <figcaption className={styles.source}>
                  {copy.source}:{" "}
                  <a href={specimen.sourcePageUrl} rel="noopener noreferrer" data-specimen-source="" data-derived="1">{caption.short}</a>
                </figcaption>
              </figure>
              <p className={styles.unedited} data-specimen-label="">{copy.unedited}</p>
              <p className={styles.text} lang={specimen.lang} data-specimen-text="" data-derived="1">{specimen.extractedText}</p>
              {specimen.limitationTokens.length > 0 ? (
                <p className={styles.limits} data-specimen-limits="">
                  {specimen.limitationTokens.map(copy.limit).join(" · ")}
                </p>
              ) : null}
              <details className={styles.more}>
                <summary><span className={styles.closed}>{copy.more}</span><span className={styles.open}>{copy.less}</span></summary>
                <p className={styles.chip} data-derived="1">{copy.box} <code>{`[${r0},${s0} → ${r1},${s1}]`}</code></p>
                <p className={styles.full} data-specimen-licence="" data-derived="1">{caption.full}</p>
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
