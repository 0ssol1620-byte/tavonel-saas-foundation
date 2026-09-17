import type { Metadata } from "next";
import Link from "next/link";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import SolutionProofSample from "@/components/solution-proof-sample";
import CompileStagePlayer, { COMPILE_STAGES } from "@/components/compile-stage-player";
import { PublicSitePage } from "@/components/public-site-chrome";
import DocumentLangKo from "./document-lang";
import { activationPolicy } from "@/lib/activation-policy";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { isLiveCommerce } from "@/lib/commercial-state";
import { pageMetadata } from "@/lib/page-seo";
import { PIPELINE_STAGES } from "@/lib/pipeline-vocabulary";

/* FD-02 (`docs/policy/DECISION_LOG_2026-09-11.md`): the activation plan gate below is a
                    delegated decision, 2026-09-11; both plan labels come from the catalog. */
const TEAM_PLAN = BILLING_OFFERS.studio_access;
const DEVELOPER_PLAN = BILLING_OFFERS.observer_access;
const KO_HERO_STAGE = [{
  id: "hero-v2-ko",
  label: "AI 활용 준비",
  line: "자료를 원문과 연결된 지식으로 정리해 AI에서 활용할 수 있게 준비합니다.",
  src: "/film/compile-cut.mp4",
  poster: "/film/poster-1.webp",
}] as const;
/*
  BQ-013. 두 컷은 한국어 페이지에 영어 탭과 영어 캡션으로 걸려 있었다(COMPILE_STAGES를 그대로 재사용).
  D12에 따라 기존 영문 문자열을 그대로 옮긴 번역이며 새 주장은 없다. id·src·poster는 잠긴 자산 그대로.
*/
const KO_WORK_STAGES = [
  { ...COMPILE_STAGES[1]!, label: PIPELINE_STAGES[2].ko, line: "관련 정보를 연결된 지식 구조로 정리합니다." },
  { ...COMPILE_STAGES[2]!, label: "업데이트", line: "바뀐 원본과 그 영향을 받는 지식을 함께 보여줍니다." },
] as const;
export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "내 자료를 AI가 쓰는 지식으로 — TAVONEL",
  description: "파일을 추가하거나 소스를 연결하고, 준비된 지식과 원문을 확인한 뒤 AI에서 활용하세요. TAVONEL의 제품 흐름과 실제 공개 샘플을 확인할 수 있습니다.",
  canonical: "/ko",
  languages: { ko: "/ko", en: "/", "x-default": "/" },
});

/** Korean entry, not a claim that the technical and legal documentation is translated. */
export default function KoreanEntryPage() {
  const live = isLiveCommerce();
  return <PublicSitePage korean>
    <DocumentLangKo />
    <BreadcrumbJsonLd trail={[{ name: "한국어 안내", path: "/ko" }]} />
    <div className="one-path-home one-path-ko">
      <section className="one-path-hero" aria-labelledby="ko-one-path-title">
        <div className="one-path-wrap">
          <div className="one-path-intro">
            {/*
              G1-043. 영문 H1("Bring your knowledge. TAVONEL makes it ready for AI.")과 같은 구조로,
              웹 헤드라인에 과한 하십시오체 대신 바로 아래 리드 문장과 같은 -하세요 어조를 쓴다.

              BQ-056: 제목을 다시 말하던 eyebrow("AI가 쓰기 좋은 지식으로")는 고쳐 쓰지 않고 지운다.
              BQ-009: 2단 그리드와 함께 <br/>도 제거한다. 줄바꿈은 측정값(measure)이 정한다.
            */}
            <h1 id="ko-one-path-title">자료를 가져오세요. AI가 쓰는 지식으로 만듭니다.</h1>
            <p className="one-path-lede">파일을 올리거나 기존 소스를 연결하세요. 복잡한 처리는 TAVONEL이 맡습니다.</p>
            <div className="one-path-actions actions"><Link className="btn" href={live ? "/login" : "/contact"}>{live ? "내 자료 추가하기" : "이용 문의"}</Link><a className="one-path-text-link" href="#ko-how-it-works">어떻게 처리되는지 보기</a></div>
            {/*
              G1-002. /pricing, /login, /security와 /status가 같은 기록에서 읽어 렌더하는 고지를
              한국어로 옮긴 문장. 이 페이지에만 없었고, 바로 아래 요금 안내가 무료 평가판에서
              업로드와 컴파일이 된다고 현재형으로 적고 있었다.
            */}
            {activationPolicy.customerData.enabled ? null : (
              <p className="notice static" role="status">
                <strong>현재 배포에서는 고객 파일 컴파일이 열려 있지 않습니다.</strong> 완성된 공개
                Compiled World는 지금 전체를 열람할 수 있고, 내 자료의 처리는 결제가 아니라 협의로
                진행합니다. <Link href="/contact">이용 문의</Link>로 시작하거나,{" "}
                <Link href="/explore">공개 샘플</Link>에서 결과와 원문을 먼저 확인하세요.
              </p>
            )}
          </div>
          {/* BQ-011 / BQ-056: 알약 모양 칩 네 개가 아니라 한 줄 캡션이다. 단계 이름은
              `PIPELINE_STAGES`의 한국어 표기를 그대로 쓴다. */}
          <div className="one-path-hero-film one-path-hero-film-v2"><p className="one-path-hero-film-steps">{PIPELINE_STAGES.map((stage, position) => <span key={stage.key}>{position > 0 ? <i aria-hidden="true" /> : null}{stage.ko}</span>)}</p><CompileStagePlayer stages={KO_HERO_STAGE} preferVideo playbackRate={1.5} compact priorityPoster korean /></div>
          {/* D3 / BQ-129: 한 문장은 영상 아래에 그대로 두고, 세 가지 차이는 펼침으로 옮긴다. */}
          <div className="one-path-film-note">
            <p>제품 흐름을 설명하는 연출 영상이며 실제 서비스 화면 녹화가 아닙니다. 영상 속 세 가지는 현재 배포보다 앞서 있습니다.</p>
            <details>
              <summary>영상과 실제 결과의 차이</summary>
              <p>영상은 추출된 표를 격자로 그리고, 결과에 절·행 번호 위치를 붙이고, 원문 목록에 .csv 파일을 보여줍니다. 현재 컴파일은 문단 단위 텍스트와 페이지·영역(bbox) 위치를 내보내며 표·수식은 추출하지 않고 CSV는 받지 않습니다. 실제 결과와 원문은 아래 공개 샘플에서 확인할 수 있습니다.</p>
            </details>
          </div>
        </div>
      </section>
      <section className="one-path-section one-path-works" id="ko-how-it-works" aria-labelledby="ko-works-title"><div className="one-path-wrap">
        <div className="one-path-section-heading"><h2 id="ko-works-title">자료만 가져오세요. 어려운 처리는 TAVONEL이 맡습니다.</h2><p>정상 문서는 자동으로 처리하고, 어려운 부분은 더 적합한 처리 경로로 보냅니다. 검증할 수 없는 항목은 조용히 통과시키지 않고 검토 대상으로 표시합니다.</p></div>
        {/* BQ-129: 영문 페이지와 같이 <ol> + <h3>. 일반 div에 aria-label을 붙여도 이름이 붙지 않는다. */}
        <ol className="one-path-workflow"><li><h3>파일 확인</h3><p>형식과 무결성, 네이티브 구조를 먼저 확인합니다.</p></li><li><h3>내용 읽기</h3><p>구조화된 경로를 우선하고 필요한 부분만 전문 처리를 사용합니다.</p></li><li><h3>자리 유지</h3><p>인쇄된 순서대로 각 영역을 읽고, 그 영역이 있던 페이지와 위치를 함께 보관합니다.</p></li><li><h3>지식 연결</h3><p>관련 정보를 원문과 분리하지 않고 연결합니다.</p></li><li><h3>출처 확인</h3><p>근거를 점검하고 예외만 검토 대상으로 올립니다.</p></li><li><h3>AI 활용 준비</h3><p>검토·승인된 결과를 AI가 사용할 수 있게 준비합니다.</p></li></ol>
        <div className="one-path-works-film"><CompileStagePlayer stages={KO_WORK_STAGES} preferVideo korean /></div>
      </div></section>
      <section className="one-path-section" aria-labelledby="ko-intake-title"><div className="one-path-wrap">
        <div className="one-path-section-heading"><h2 id="ko-intake-title">자료가 있는 곳에서 시작하세요.</h2><p>파일·폴더·ZIP을 선택하거나 연결 가능한 소스를 확인하세요. 고객이 parser나 모델을 고르지 않아도 됩니다.</p></div>
        <div className="one-path-links"><Link href="/integrations">연결 방식 확인</Link><Link href="/sources">지원 파일 확인</Link><Link href="/pricing">요금 확인</Link></div>
      </div></section>
      <section className="one-path-section" aria-labelledby="ko-proof-title"><div className="one-path-wrap">
        <div className="one-path-section-heading"><h2 id="ko-proof-title">결과에서 원문까지 다시 따라갈 수 있습니다.</h2><p>공개 Apple SEC 자료의 원문 페이지와 추출된 내용을 나란히 살펴보세요. 연출 영상과 실제 결과를 구분해 보여드립니다.</p></div>
        <div className="one-path-source-proof" aria-label="공개 샘플과 원문"><SolutionProofSample /></div>
        <div className="one-path-links"><Link href="/explore">공개 샘플 열기</Link><Link href="/docs/use-with-ai">AI 활용 방법</Link></div>
      </div></section>
      <section className="one-path-section" aria-labelledby="ko-current-title"><div className="one-path-wrap">
        <div className="one-path-section-heading"><h2 id="ko-current-title">원문이 바뀌면, 지식도 따라갑니다.</h2><p>영향받는 변경을 준비하는 동안 현재 활성 버전은 유지하고, 무엇이 바뀌었는지 검토한 뒤 새 버전을 승인합니다.</p></div>
        <ol className="one-path-update-steps"><li><h3>변경 준비</h3><p>새 후보를 준비하는 동안 현재 결과를 계속 사용할 수 있습니다.</p></li><li><h3>변경 확인</h3><p>결정이 필요한 항목만 원문과 함께 검토합니다.</p></li><li><h3>활성화 승인</h3><p>승인 후 새 버전이 활성화되며 이전 버전의 추적성은 유지됩니다.</p></li></ol>
      </div></section>
      <section className="one-path-section" aria-labelledby="ko-use-title"><div className="one-path-wrap">
        <div className="one-path-section-heading"><h2 id="ko-use-title">준비된 지식을 내 AI로.</h2><p>지원되는 연결을 설정하거나 지식 패키지를 활용하세요. 활성화는 사람이 승인하며, 연결 설정을 열었다고 실제 연결 성공으로 표시하지 않습니다.</p></div>
        <details className="one-path-details"><summary>요금과 활성화 조건</summary><p>활성화는 유료 플랜에서 제공됩니다. 워크스페이스 소유자라면 {DEVELOPER_PLAN.label} 플랜에서, 또는 {TEAM_PLAN.label} 플랜에서 활성화할 수 있습니다. {TEAM_PLAN.label} 플랜은 상담을 거쳐 제공됩니다. 다만 현재 배포에서는 고객 파일의 업로드·컴파일 자체가 열려 있지 않으므로, 플랜과 무관하게 내 자료 처리는 협의를 거쳐 시작합니다. 가격은 미국 달러(USD) 기준이며 세금은 별도입니다. 각 플랜의 정확한 범위는 Pricing 페이지가 기준입니다.</p><Link className="one-path-text-link" href="/pricing">요금과 플랜 범위</Link></details>
        <details className="one-path-details"><summary>기술 문서와 보안 안내</summary><div className="one-path-links"><Link href="/product">Product</Link><Link href="/docs">Documentation</Link><Link href="/sources">Sources</Link><Link href="/security">Security</Link><Link href="/trust">Trust Center</Link></div><p>도입 검토와 기술 문의는 한국어로 받습니다. 제품·문서·요금의 기준 문서는 영문이며, 위 링크는 영문 페이지로 연결됩니다.</p></details>
      </div></section>
    </div>
  </PublicSitePage>;
}
