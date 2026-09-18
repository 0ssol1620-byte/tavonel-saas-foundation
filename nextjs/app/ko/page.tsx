import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import CompileStagePlayer from "@/components/compile-stage-player";
import { COMPILE_STAGES } from "@/lib/compile-stages";
import { PublicSitePage } from "@/components/public-site-chrome";
import DocumentLangKo from "./document-lang";
import { activationPolicy } from "@/lib/activation-policy";
import { isLiveCommerce } from "@/lib/commercial-state";
import { LANDING_FRAMES } from "@/lib/landing-frames";
import { FIRST_CALL } from "@/lib/developer-snippets";
import { pageMetadata } from "@/lib/page-seo";
import { BILLING_OFFERS } from "@/lib/billing-catalog"
import { CAPABILITY_MANIFEST, describeAcceptedFormats } from "../../../shared/capabilityManifest";

/*
  랜딩 리플랜, 2026-09-18. 영문 `components/home-page-client.tsx`와 같은 다섯 섹션, 같은 섹션 id,
  같은 프레임 세 장. D12에 따라 영문 문자열을 그대로 옮긴 번역이며 새 주장은 없다. 숫자는 없다.

  히어로 필름은 영문 페이지와 같은 재렌더 마스터(`compile-cut-hq.mp4`)를 쓴다. 잠긴 네 컷은
  그대로 남아 있고, 이 페이지는 그중 어느 것도 더 이상 재생하지 않는다.
*/
const KO_HERO_STAGE = [{
  id: "hero-v3-ko",
  label: "컴파일",
  line: "모든 결과에서 원문까지 되짚어 갈 수 있는, 컴파일된 지식.",
  src: "/film/compile-cut-hq.mp4",
  phoneSrc: "/film/compile-cut-hq-1440.mp4",
  poster: "/film/poster-1-hero-2x.webp",
}] as const;
// Guard: the stage table is read from the plain module, not from the client player (landing-01).
const _stages: typeof COMPILE_STAGES = COMPILE_STAGES;
void _stages;

const KO_STEPS = [
  {
    id: "compile",
    title: "컴파일",
    body: "파일과 연결 소스가 들어옵니다. 모든 문단은 인쇄된 페이지와 그 위의 영역을 그대로 간직하므로, 결과의 어느 부분도 출처에서 떨어지지 않습니다.",
    frame: LANDING_FRAMES.compile,
  },
  {
    id: "verify",
    title: "검증",
    body: "읽어 온 문단 옆에서 원문 페이지를 여세요. TAVONEL이 검증할 수 없는 것은 조용히 받아들이지 않고 검토 대상으로 드러냅니다.",
    frame: LANDING_FRAMES.verify,
  },
  {
    id: "recompile",
    title: "재컴파일",
    body: "원문이 바뀌면 그 변경이 닿는 부분만 다시 만듭니다. 새 버전을 활성화하기 전까지 현재 버전이 그대로 유지됩니다.",
    frame: LANDING_FRAMES.recompile,
  },
] as const;

const KO_PROPERTIES = [
  ["발췌가 아닌 근거", "컴파일된 객체는 읽어 온 페이지와 영역을 가리키고, 원문은 그 옆에 남습니다."],
  ["유지되는 정체성", "한 개체는 자신을 언급하는 문서들 전체에서 하나의 정체성을 유지하며, 파일마다 새 노드가 되지 않습니다."],
  ["시간의 순서", "버전에는 순서가 있습니다. 대체된 진술은 답에서 사라지지 않고 추적 가능하게 남습니다."],
  ["유지되는 의존 관계", "바뀐 조항은 그것에 의존하는 부분만 다시 만듭니다. 재컴파일이 재실행보다 저렴한 이유입니다."],
  ["실패 시 닫힘", "검증할 수 없는 지식은 검증된 것처럼 발행되지 않습니다. 검토를 위해 보류되고, 화면이 그렇게 말합니다."],
] as const;

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "내 자료를 AI가 사용하는 지식으로 — TAVONEL",
  description: "TAVONEL은 지식 컴파일러입니다. 컴파일된 모든 결과는 읽어 온 페이지까지 되짚어 갈 수 있는 경로를 유지합니다. 공개 Compiled World를 지금 전체 열람할 수 있습니다.",
  canonical: "/ko",
  languages: { ko: "/ko", en: "/", "x-default": "/" },
});

/** Korean entry, not a claim that the technical and legal documentation is translated. */
export default function KoreanEntryPage() {
  const live = isLiveCommerce();
  const startHref = (live ? "/login" : "/contact") as Route;
  const startLabel = live ? "내 자료로 시작하기" : "이용 문의";
  return <>
    {/* The hero poster is the LCP resource; a real <link> reaches <head>, react-dom preload() did not (MED-15). */}
    <link rel="preload" as="image" href="/film/poster-1-hero-2x.webp" fetchPriority="high" />
    <PublicSitePage korean>
    <DocumentLangKo />
    <BreadcrumbJsonLd trail={[{ name: "한국어 안내", path: "/ko" }]} />
    <div className="one-path-home one-path-ko">
      <section className="one-path-hero" id="top" aria-labelledby="ko-one-path-title" data-scene="1" tabIndex={-1}>
        <div className="one-path-wrap">
          <div className="one-path-intro">
            {/* G1-043. 영문 H1과 같은 구조. BQ-116 / D12: 동사는 KO_TERMS의 "사용". */}
            {/* COPY-05. 독자 호명 한 줄, 헤드라인 앞. */}
            <p className="one-path-audience">답이 원문까지 추적되어야 하는 팀을 위해: 공시, 계약, 표준, 매뉴얼.</p>
            <h1 id="ko-one-path-title">자료를 가져오세요. AI가 사용하는 지식으로 만듭니다.</h1>
            <p className="one-path-lede">모든 결과에서 원문까지 되짚어 갈 수 있는, 컴파일된 지식.</p>
            <div className="one-path-actions actions">
              <Link className="btn" href={startHref}>{startLabel}</Link>
              <Link className="one-path-text-link" href="/explore">공개 Compiled World 열기</Link>
            </div>
            {/* G1-002. /pricing, /login, /security, /status가 같은 기록에서 읽어 렌더하는 고지의 한국어 문장. */}
            {activationPolicy.customerData.enabled ? null : (
              <p className="one-path-state" data-customer-data="arranged">
                현재 배포에서는 고객 파일 컴파일이 열려 있지 않습니다. 완성된 공개 Compiled World는 지금 전체를 열람할 수 있고, 내 자료의 처리는 결제가 아니라 협의로 진행합니다.
              </p>
            )}
          </div>
          <div className="one-path-hero-film one-path-hero-film-v2"><CompileStagePlayer stages={KO_HERO_STAGE} preferVideo playbackRate={1.5} compact priorityPoster korean /></div>
          <p className="one-path-film-note">
            제품 흐름을 설명하는 연출 영상이며 실제 화면 녹화가 아닙니다. 영상 속 격자로 그린 표, 절·행 번호 위치, <code>.csv</code> 원문은 현재 배포보다 앞서 있습니다. 지금 컴파일이 내보내는 것은 인쇄된 그대로의 문단과 그것을 읽어 온 페이지·영역이며, 아래 세 프레임이 실제 라우트에서 본 그 결과입니다.
          </p>
        </div>
      </section>

      <section className="one-path-section one-path-steps-section" id="compile" data-scene="2" aria-labelledby="ko-steps-title" tabIndex={-1}>
        <div className="one-path-wrap">
          <div className="one-path-section-heading">
            <h2 id="ko-steps-title">컴파일. 검증. 재컴파일.</h2>
            <p>세 단계가 실행되는 순서 그대로입니다. 사람이 승인하기 전에는 아무것도 활성화되지 않습니다.</p>
          </div>
          <ol className="one-path-steps">
            {KO_STEPS.map((step, index) => (
              <li key={step.id} className="one-path-step" data-side={index % 2 ? "right" : "left"}>
                <figure className="one-path-frame">
                  <Link href={step.frame.href as Route} prefetch={false} aria-label={`${step.title} 화면 열기`}>
                    <picture>
                      <source media="(max-width: 799px)" srcSet={step.frame.phone.src} width={step.frame.phone.width} height={step.frame.phone.height} />
                      <img src={step.frame.desktop.src} width={step.frame.desktop.width} height={step.frame.desktop.height} alt={step.frame.ko.alt} loading="lazy" decoding="async" />
                    </picture>
                  </Link>
                  <figcaption>{step.frame.ko.caption}</figcaption>
                </figure>
                <div className="one-path-step-copy">
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <Link className="one-path-text-link" href={step.frame.href as Route} prefetch={false}>{`${step.title} 화면 열기`}</Link>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="one-path-section one-path-why" id="why" data-scene="3" aria-labelledby="ko-why-title" tabIndex={-1}>
        <div className="one-path-wrap">
          <div className="one-path-section-heading">
            <h2 id="ko-why-title">파서는 텍스트를 돌려주고, 컴파일러는 의존 관계를 유지합니다.</h2>
            <p>문서를 한 번 읽는 것은 쉬운 부분입니다. 다시 실행해도 만들어 낼 수 없는 것은 결과들을 서로 연결하는 모든 것이고, Compiled World가 담는 것이 바로 그것입니다.</p>
          </div>
          <dl className="one-path-properties">
            {KO_PROPERTIES.map(([term, detail]) => (
              <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>
            ))}
          </dl>
          <div className="one-path-links">
            <Link href="/knowledge-compiler" prefetch={false}>지식 컴파일러란</Link>
            <Link href={"/product/continuous-knowledge" as Route} prefetch={false}>원문 업데이트 처리 방식</Link>
          </div>
        </div>
      </section>

      <section className="one-path-section one-path-io" id="sources" data-scene="4" aria-labelledby="ko-io-title" tabIndex={-1}>
        <div className="one-path-wrap">
          <div className="one-path-section-heading">
            <h2 id="ko-io-title">있는 자료를 가져오세요. 일하는 곳에서 사용하세요.</h2>
            <p>설정할 것이 없습니다. 무엇을 가져올지만 고르면 경로는 TAVONEL이 정합니다. 결과는 어시스턴트, 내 애플리케이션, 또는 검증 가능한 이동식 패키지로 나갑니다.</p>
          </div>
          <div className="one-path-io-grid">
            <div className="one-path-io-col">
              <h3>들어오는 것</h3>
              <ul>
                <li><strong>파일·폴더·ZIP</strong><span>컴퓨터에서 묶음을 선택합니다. 실행 전에 선택 내용과 가격을 먼저 확인합니다.</span><Link href={startHref} prefetch={false}>{live ? "파일로 시작하기" : "내 파일 컴파일 문의"}</Link></li>
                <li><strong>연결 소스</strong><span>연결 가능한 클라우드 소스를 확인하고, TAVONEL이 읽도록 허용할 파일을 고릅니다.</span><Link href="/integrations" prefetch={false}>연결 방식 확인</Link></li>
                <li><strong>프라이빗 인프라</strong><span>오브젝트 스토리지나 마운트된 공유 폴더를, 고객 환경 안에서 함께 설정합니다.</span><Link href="/sources" prefetch={false}>지원 파일 확인</Link></li>
              </ul>
            </div>
            <div className="one-path-io-col">
              <h3>나가는 것</h3>
              <ul>
                <li><strong>AI 어시스턴트</strong><span>MCP로 연결합니다. 이미 질문하는 곳에서 같은 지식을 인용과 함께 사용합니다.</span><Link href="/docs/use-with-ai" prefetch={false}>AI 활용 방법</Link></li>
                <li><strong>내 애플리케이션</strong><span>API로 구축합니다.</span><Link href="/docs/quickstart" prefetch={false}>퀵스타트</Link></li>
                <li><strong>이동식 파일</strong><span>패키지를 가져가고, 공개된 검증 도구로 안에 든 것을 확인합니다.</span><Link href="/docs/cli" prefetch={false}>CLI와 패키지 검증</Link></li>
              </ul>
            </div>
            <figure className="one-path-code">
              <figcaption>개발자 가이드의 첫 호출</figcaption>
              <pre role="region" tabIndex={0} aria-label="첫 API 호출 curl 명령. 긴 줄은 가로로 스크롤해 읽을 수 있습니다."><code>{FIRST_CALL}</code></pre>
            </figure>
          </div>
        </div>
      </section>

      <section className="one-path-section one-path-close" id="start" data-scene="5" aria-labelledby="ko-close-title" tabIndex={-1}>
        <div className="one-path-wrap">
          <div className="one-path-section-heading">
            <h2 id="ko-close-title">이미 컴파일된 World에서 시작하세요.</h2>
            <p>지금 전체를 읽어 보고, 다음에 컴파일할 것을 알려 주세요.</p>
          </div>
          <div className="one-path-actions actions">
            <Link className="btn" href={startHref}>{startLabel}</Link>
            <Link className="one-path-text-link" href="/explore">공개 Compiled World 열기</Link>
            <Link className="one-path-text-link" href="/pricing" prefetch={false}>요금 확인</Link>
          </div>
          {/* FD-02 (`docs/policy/DECISION_LOG_2026-09-11.md`): the activation plan gate below is a
              delegated decision, 2026-09-11; both plan labels come from the catalog. 랜딩 리플랜에서
              접힘으로 돌아왔다: 이 세 문장이 한국어로 게재되는 유일한 자리다. */}
          <details className="one-path-details one-path-plan-details"><summary>요금과 활성화 조건</summary><p>활성화는 유료 플랜에서 제공됩니다. 워크스페이스 소유자라면 {BILLING_OFFERS.observer_access.label} 플랜에서, 또는 {BILLING_OFFERS.studio_access.label} 플랜에서 활성화할 수 있습니다. {BILLING_OFFERS.studio_access.label} 플랜은 상담을 거쳐 제공됩니다. 다만 현재 배포에서는 고객 파일의 업로드·컴파일 자체가 열려 있지 않으므로, 플랜과 무관하게 내 자료 처리는 협의를 거쳐 시작합니다. 가격은 미국 달러(USD) 기준이며 세금은 별도입니다. 각 플랜의 정확한 범위는 Pricing 페이지가 기준입니다.</p><Link className="one-path-text-link" href="/pricing" prefetch={false}>요금과 플랜 범위</Link></details>
          {/* COPY-44 / TRUST-07. 영문 FAQ와 같은 여섯 질문, 답은 해당 페이지의 문장을 옮긴 것. */}
          <div className="one-path-faq">
            <h3 id="ko-faq-title">먼저 받는 질문</h3>
            <details className="one-path-details"><summary>내 문서가 모델 학습에 쓰이나요?</summary><p>아닙니다. 고객 문서는 공유 모델의 학습에 쓰이지 않습니다. 모델은 World를 컴파일하기 위해 원문을 읽을 뿐, 다른 용도로는 쓰지 않습니다. <Link href="/security" prefetch={false}>보안</Link></p></details>
            <details className="one-path-details"><summary>어떤 모델 제공자가 내 문서를 보나요?</summary><p>현재 배포에서는 어떤 외부 모델 API도 고객 문서를 받지 않습니다. 문서 읽기는 TAVONEL이 운영하는 GPU 워커에서 실행되며, 모든 문서는 적대적 데이터로 다룹니다. <Link href="/security" prefetch={false}>보안</Link></p></details>
            <details className="one-path-details"><summary>검증되지 않는 문단은 어떻게 되나요?</summary><p>검토 대상으로 표시되어 보류되며, 검증된 것처럼 게재되지 않습니다. 실패 시 닫힘은 설정이 아니라 컴파일러의 성질입니다. <Link href="/trust" prefetch={false}>Trust Center</Link></p></details>
            <details className="one-path-details"><summary>어떤 자료를 가져올 수 있나요?</summary><p>{describeAcceptedFormats(CAPABILITY_MANIFEST)} 형식을 파일·폴더·ZIP으로, 그리고 연결된 소스에서 가져올 수 있습니다. 허용되는 모든 형식은 PDF로 정제해 같은 방식으로 읽으므로, 문단마다 페이지와 영역이 남습니다. <Link href="/sources" prefetch={false}>지원 소스</Link></p></details>
            <details className="one-path-details"><summary>지금 내 파일을 컴파일할 수 있나요?</summary><p>현재 배포에서는 고객 파일 컴파일이 열려 있지 않습니다. 완성된 공개 Compiled World는 지금 전체를 열람할 수 있고, 내 자료의 처리는 결제가 아니라 협의로 진행합니다. <Link href={startHref}>{startLabel}</Link></p></details>
            <details className="one-path-details"><summary>업로드한 자료를 삭제할 수 있나요?</summary><p>원본 자료, 파생 산출물, 컴파일된 패키지는 요청 시 삭제되며, 그 요청은 셀프서비스 버튼이 아니라 사람이 처리합니다. <Link href="/security" prefetch={false}>보존과 삭제</Link></p></details>
          </div>
          <p className="one-path-fine">문서는 적대적 데이터로 다룹니다. 문서를 읽는 모델에는 도구도, 넓은 자격 증명도, 외부 네트워크도 없습니다. <Link href="/security" prefetch={false}>보안</Link> · <Link href="/trust" prefetch={false}>Trust Center</Link></p>
        </div>
      </section>
    </div>
  </PublicSitePage>
  </>;
}
