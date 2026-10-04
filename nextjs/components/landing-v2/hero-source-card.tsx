import Link from "next/link";
import type { Route } from "next";
import { buildHeroView } from "@/lib/landing-v2-runtime";

/** The hero is a view of the committed artifact, never a simulated compile. */
export default function HeroSourceCard({ korean = false }: { korean?: boolean }) {
  const view = buildHeroView();
  const region = view.regions.find((item) => item.excerpt.length > 80) ?? view.regions[0];
  if (!region) return null;
  const [x, y, x2, y2] = region.bbox1000;
  return <article className="paper-source" aria-label={korean ? "공개 문서 근거" : "Public document evidence"}>
    <header><span>{korean ? "공개 샘플 · 읽기 전용" : "Public sample · read only"}</span><span>{korean ? "원문 연결됨" : "Source linked"}</span></header>
    <div className="paper-source-body">
      <div className="paper-source-page">
        {view.image ? <>
          {/* eslint-disable-next-line @next/next/no-img-element -- preserve the committed source raster */}
          <img src={view.image.src} width={view.image.width} height={view.image.height} alt={korean ? "공개 자료의 원문 페이지" : "Source page from the public document"} fetchPriority="high" decoding="async" loading="eager" />
          <span aria-hidden="true" className="paper-source-box" style={{left: `${x / 10}%`, top: `${y / 10}%`, width: `${(x2 - x) / 10}%`, height: `${(y2 - y) / 10}%`}} />
        </> : <p>{view.imageAbsentReason}</p>}
      </div>
      <div className="paper-source-result">
        <p className="paper-label">{korean ? "원문에서 읽은 구절" : "Read from the source"}</p>
        <blockquote data-derived="1">{region.excerpt}{region.excerptTruncated ? "…" : ""}</blockquote>
        <p className="paper-source-locator" data-derived="1">{view.source.filename}<br />{korean ? `${view.source.page}쪽 · ${view.source.qualifierKo}` : `Page ${view.source.page} · ${view.source.qualifier}`}</p>
        <Link href={region.href as Route}>{korean ? "이 근거 확인하기" : "Inspect this evidence"} <span aria-hidden="true">↗</span></Link>
      </div>
    </div>
    <footer>{korean ? "검증된 샘플 아티팩트에서 표시합니다. 고객 성과를 나타내지 않습니다." : "Rendered from the committed sample artifact. This is not a customer performance claim."}</footer>
  </article>;
}
