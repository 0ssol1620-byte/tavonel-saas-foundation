import Link from "next/link";
import { gdpPdfReport, gdpPdfPoints } from "@/lib/gdp-pdf-page-data";
import styles from "./landing-hero.module.css";

/** Aggregate-only publication from the existing immutable evaluation artifact. */
export default function HomeMeasurement({ korean = false }: { korean?: boolean }) {
  const report = gdpPdfReport();
  const native = report.arms.native_pdf;
  const compiled = report.arms.compiled_context_pdf;
  return <section className={styles.measurement} aria-labelledby="home-measurement-title" data-home-measurement>
    <div className="lv2-wrap">
      <div className={styles.measurementLead}>
        <h2 className="lv2-h2" id="home-measurement-title">{korean ? "측정 결과와 조건을 함께 공개합니다." : "Measured. With the receipt."}</h2>
        <p>{korean ? "GDP.pdf 과제에서 같은 모델에 컴파일된 맥락을 추가한 효과를 측정했습니다." : "A GDP.pdf evaluation measured what compiled context added to the same model."}</p>
      </div>
      <dl className={styles.measurementResults}>
        <div><dt>{korean ? "PDF 단독 · 모든 기준 통과" : "PDF alone · all criteria passed"}</dt><dd data-derived="1">{native.macro_all_pass_count}<span> / {native.n}</span></dd></div>
        <div><dt>{korean ? "PDF + 컴파일된 맥락" : "PDF + compiled context"}</dt><dd data-derived="1">{compiled.macro_all_pass_count}<span> / {compiled.n}</span></dd></div>
        <div><dt>{korean ? "짝지은 과제의 차이" : "Paired task difference"}</dt><dd data-derived="1">{gdpPdfPoints(report.pairwise_delta.macro_delta_pp)}</dd></div>
      </dl>
      <p className={styles.measurementBoundary}>{korean ? "과거의 비공식 조건 평가입니다. 이 실행에서 컴파일된 맥락은 결과를 개선하지 못했습니다. 공개 GDP.pdf 점수나 경쟁사와 비교할 수 없습니다." : "Historical evaluation under unofficial conditions. Compiled context did not improve this run. These results cannot be compared with published GDP.pdf scores or competitors."}</p>
      <Link className={styles.diffLink} href="/benchmarks/gdp-pdf">{korean ? "전체 결과와 실행 조건 보기" : "Read the full result and conditions"}</Link>
    </div>
  </section>;
}
