import Link from "next/link";
import type { Route } from "next";
import { buildHeroView, buildProofTabs } from "@/lib/landing-v2-runtime";

/** Bind a complete prepared quotation to the very page and region being shown. */
export function selectHeroPreparedSample(view: ReturnType<typeof buildHeroView>, tabs: ReturnType<typeof buildProofTabs>) {
  for (const sample of tabs) {
    if (sample.source.digest !== view.source.digest || sample.source.page !== view.source.page ||
        sample.source.filename !== view.source.filename || !sample.question.trim() || sample.answerTruncated) continue;
    const region = view.regions.find(item => item.id === sample.region.id);
    if (region && !region.excerptTruncated && sample.answerExcerpt === region.excerpt &&
        sample.openHref === region.href && sample.region.bbox1000.length === region.bbox1000.length &&
        sample.region.bbox1000.every((coordinate, index) => coordinate === region.bbox1000[index])) {
      return { sample, region };
    }
  }
  return null;
}

/** The hero is a view of the committed artifact, never a simulated compile. */
export default function HeroSourceCard({ korean = false }: { korean?: boolean }) {
  const view = buildHeroView();
  const prepared = selectHeroPreparedSample(view, buildProofTabs());
  if (!prepared) return null;
  const { sample, region } = prepared;
  const [x, y, x2, y2] = region.bbox1000;
  return <article className="paper-source" data-source-digest={view.source.digest} data-source-page={view.source.page} aria-label={korean ? "공개 문서 근거" : "Public document evidence"}>
    <header><span>{korean ? "준비된 샘플 · 읽기 전용" : "Prepared sample · read only"}</span><span>{korean ? "원문 연결됨" : "Source linked"}</span></header>
    <p className="paper-source-question" lang="en" data-derived="1">{sample.question}</p>
    <div className="paper-source-body">
      <div className="paper-source-page">
        {view.image ? <>
          {/* eslint-disable-next-line @next/next/no-img-element -- preserve the committed source raster */}
          <img src={view.image.src} width={view.image.width} height={view.image.height} alt={korean ? "공개 자료의 원문 페이지" : "Source page from the public document"} fetchPriority="high" decoding="async" loading="eager" />
          <span aria-hidden="true" className="paper-source-box" data-region-id={region.id} style={{left: `${x / 10}%`, top: `${y / 10}%`, width: `${(x2 - x) / 10}%`, height: `${(y2 - y) / 10}%`}} />
        </> : <p>{view.imageAbsentReason}</p>}
      </div>
      <div className="paper-source-result">
        <p className="paper-label">{korean ? "원문 인용" : "Source quotation"}</p>
        <blockquote lang="en" data-derived="1">{sample.answerExcerpt}</blockquote>
        <p className="paper-source-locator" data-derived="1">{view.source.filename}<br />{korean ? `${view.source.page}쪽 · ${view.source.qualifierKo}` : `Page ${view.source.page} · ${view.source.qualifier}`}</p>
        <Link href={region.href as Route}>{korean ? "이 근거 확인하기" : "Inspect this evidence"} <span aria-hidden="true">↗</span></Link>
      </div>
    </div>
    <footer>{korean ? "검증된 샘플 아티팩트에서 표시합니다. 고객 성과를 나타내지 않습니다." : "Rendered from the committed sample artifact. This is not a customer performance claim."}</footer>
  </article>;
}
