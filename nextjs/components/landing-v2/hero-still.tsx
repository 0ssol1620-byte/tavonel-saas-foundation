import { displayableRegions, type EvidenceCase } from "@/lib/home-evidence-view";
import heroStyles from "./landing-hero.module.css";
import styles from "./source-first-home.module.css";

/*
  Direction C, round 2 (CRITIQUE-R1 #1, interim until the film is re-recorded on a light canvas): below
  900px the four-stage recording shrinks its four panels to 3-4px type, so the first screen shows one
  readable thing instead -- the same committed page s2 opens on, with the regions the reader drew on
  it. Nothing is generated: the raster, the boxes and every figure come from the published sample's
  evidence case, the same one s2 renders. Above 900px this figure is not displayed and the film plays
  as before; the film's bytes and its player are untouched.

  Server-rendered and inert: the boxes are drawings, the one link goes down to s2, where the page is
  interactive. No figure outside a [data-derived] element.
*/
const letter = (index: number) => String.fromCharCode(65 + index);

export default function HeroStill({ view, korean = false }: { view: EvidenceCase | null; korean?: boolean }) {
  if (!view) return null;
  const regions = displayableRegions(view);
  const active = regions.find(region => region.id === view.selectedRegionId) ?? regions[0];
  const source = view.sources.find(item => item.id === active?.sourceId);
  const page = view.pages.find(item => item.sourceId === active?.sourceId && item.page === active?.page);
  if (!active || !source || !page?.image) return null;
  const onPage = regions.filter(region => region.sourceId === active.sourceId && region.page === active.page);
  const start = Math.max(0, Math.min(...onPage.map(region => region.bbox1000[1])) - 80);
  const end = Math.min(1000, Math.max(...onPage.map(region => region.bbox1000[3])) + 80);
  return (
    <figure className={styles.heroStill} data-testid="landing-hero-still">
      <div
        className={heroStyles.pageWindow}
        style={{ aspectRatio: `${page.image.width} / ${(page.image.height * (end - start)) / 1000}` }}
      >
        <div className={heroStyles.pageSheet} style={{ transform: `translateY(-${start / 10}%)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the committed raster, the same file s2 opens */}
          <img
            src={page.image.src}
            width={page.image.width}
            height={page.image.height}
            alt={korean ? "구절을 추출한 공시 문서의 페이지 렌더입니다." : "A rendered page of the filing the passage was extracted from."}
            decoding="async"
            loading="lazy"
          />
          {onPage.map((region, index) => {
            const [x, y, x2, y2] = region.bbox1000;
            return (
              <span
                key={region.id}
                aria-hidden="true"
                className={heroStyles.box}
                data-selected={region.id === active.id ? "1" : undefined}
                style={{ left: `${x / 10}%`, top: `${y / 10}%`, width: `${(x2 - x) / 10}%`, height: `${(y2 - y) / 10}%` }}
              >
                <span className={heroStyles.boxMark}>{letter(index)}</span>
              </span>
            );
          })}
        </div>
      </div>
      <figcaption className={styles.heroStillCaption}>
        <span data-derived="1" lang="en">{source.filename}</span>
        <span data-derived="1">{korean ? `${active.page}쪽 · 영역 ${onPage.length}개` : `page ${active.page} · ${onPage.length} regions`}</span>
        <a href="#s2">{korean ? "영역 따라가기" : "Follow a region below"}<span aria-hidden="true">&nbsp;↓</span></a>
      </figcaption>
    </figure>
  );
}
