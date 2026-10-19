import type { CSSProperties } from "react";
import { capabilityTokenLabel } from "../../../shared/capabilityManifest";
import type { Specimen, SpecimenSlot } from "@/lib/specimen-sources";
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
  (SPECIMEN-CANDIDATES §4.4, the KOGL sentence on /ko) opens with "Show full text". The first crop
  is the strip's largest paint on a phone, so it is fetched at high priority and the others lazily
  (SYNTHESIS §7, LCP). It is offered as AVIF at 720 and 960 px first, so a phone takes the 720 px
  file; the WEBP is the fallback. CROP_SIZES is the cell: the content width on a phone, half the
  row from 1024 px.
*/

const CROP_SIZES = "(min-width: 1024px) 50vw, calc(100vw - 32px)";

const COPY = {
  en: {
    strip: "Pages read by the reader",
    choose: "Specimen page",
    kind: { degraded_scan: "Scanned page", table: "Table page", korean: "Korean document" } satisfies Record<SpecimenSlot, string>,
    synthetic: "synthetic fixture",
    asPrinted: "As printed",
    source: "Source",
    unedited: "Reader output, unedited",
    receipt: "receipt",
    more: "Show full text",
    less: "Show less",
    crop: (kind: string) => `${kind}: the window around the region the reader read`,
  },
  ko: {
    strip: "판독기가 읽은 페이지",
    choose: "표본 페이지",
    kind: { degraded_scan: "스캔한 페이지", table: "표가 있는 페이지", korean: "한국어 문서" } satisfies Record<SpecimenSlot, string>,
    synthetic: "합성 픽스처",
    asPrinted: "원문 그대로",
    source: "출처",
    unedited: "판독기 출력, 수정 없음",
    receipt: "receipt",
    more: "전체 보기",
    less: "접기",
    crop: (kind: string) => `${kind}: 판독기가 읽은 영역을 둘러싼 부분`,
  },
};

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

export default function SpecimenStrip({ specimens, korean = false }: { specimens: readonly Specimen[]; korean?: boolean }) {
  if (specimens.length === 0) return null;
  const copy = COPY[korean ? "ko" : "en"];
  return (
    <div className={styles.strip} role="region" aria-label={copy.strip} data-specimen-strip="" data-cells={specimens.length}>
      {specimens.length > 1 ? (
        <div className={styles.tabs} role="radiogroup" aria-label={copy.choose}>
          {specimens.map((specimen, index) => (
            <label className={styles.tab} key={specimen.specimenId}>
              <input type="radio" name="specimen-page" value={specimen.specimenId} defaultChecked={index === 0} data-specimen-tab="" />
              {copy.kind[specimen.slot]}
            </label>
          ))}
        </div>
      ) : null}
      <ol className={styles.cells}>
        {specimens.map((specimen, index) => {
          const caption = specimen.caption[korean ? "ko" : "en"];
          // UX §3.4-2: the coordinates as stored, then the same place for a reader who does not read them.
          const [r0, s0, r1, s1] = specimen.region.bbox1000;
          const [x0, y0, x1, y1] = specimen.crop.window1000;
          return (
            <li className={styles.cell} key={specimen.specimenId} data-specimen-cell={specimen.specimenId} data-slot={specimen.slot}>
              <p className={styles.kind}>
                {copy.kind[specimen.slot]}
                {specimen.synthetic ? <span> · {copy.synthetic}</span> : null}
              </p>
              <p className={styles.chip} data-derived="1">
                <code>{`p.${specimen.page} · [${r0},${s0} → ${r1},${s1}]`}</code>{" "}
                <span>{korean ? `${specimen.page}쪽 · 영역 A` : `page ${specimen.page} · region A`}</span>
              </p>
              <figure className={styles.crop} data-specimen-crop="" data-crop-window={`${x0},${y0},${x1},${y1}`}>
                <div className={styles.frame}>
                  {/* Plain <picture>, not next/image: a fixed crop with its receipt's own size; no optimizer may re-encode source pixels (specimen §4.5). */}
                  <picture>
                    {specimen.crop.sources?.length ? (
                      <source type="image/avif" sizes={CROP_SIZES}
                        srcSet={specimen.crop.sources.map(source => `${source.path} ${source.width}w`).join(", ")} />
                    ) : null}
                    <img src={specimen.cropSrc} width={specimen.crop.width} height={specimen.crop.height}
                      alt={copy.crop(copy.kind[specimen.slot])} decoding="async"
                      fetchPriority={index === 0 ? "high" : undefined} loading={index === 0 ? undefined : "lazy"} />
                  </picture>
                  <span className={styles.region} style={outline(specimen)} data-specimen-region={specimen.region.regionId} aria-hidden="true" />
                </div>
                <figcaption className={styles.source}>
                  {copy.asPrinted} · {copy.source}:{" "}
                  <a href={specimen.sourcePageUrl} rel="noopener noreferrer" data-specimen-source="" data-derived="1">{caption.short}</a>
                </figcaption>
              </figure>
              <p className={styles.text} lang={specimen.lang} data-specimen-text="" data-derived="1">{specimen.extractedText}</p>
              <details className={styles.more}>
                <summary><span className={styles.closed}>{copy.more}</span><span className={styles.open}>{copy.less}</span></summary>
                <p className={styles.full} data-specimen-licence="" data-derived="1">{caption.full}</p>
              </details>
              <p className={styles.run}>
                <span>{copy.unedited}</span>
                {" · "}
                <a href={specimen.runReceiptUrl} rel="noopener noreferrer" data-derived="1" data-specimen-receipt="">
                  {specimen.runAt.slice(0, 10)} · {copy.receipt} {specimen.runReceiptSha256.slice(7, 15)}
                </a>
              </p>
              {specimen.limitationTokens.length > 0 ? (
                <p className={styles.limits} lang="en">
                  {specimen.limitationTokens.map(capabilityTokenLabel).join(" · ")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
