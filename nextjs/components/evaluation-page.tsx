import Link from "next/link";
import ContactForm from "@/components/contact-form";
import { PublicSiteHeader, PublicSiteFooter } from "@/components/public-site-chrome";
import { activationPolicy } from "@/lib/activation-policy";
import { KO_CHROME } from "@/lib/site-navigation";

export default function EvaluationPage({ korean = false }: { korean?: boolean }) {
  return <div className="page paper-product evaluation-page" lang={korean ? "ko" : "en"}>
    <PublicSiteHeader korean={korean} />
    <main id="main" className="evaluation-shell">
      <section className="evaluation-intro">
        <p className="paper-label">{korean ? "내 문서 / 범위를 정한 평가" : "Your documents / a bounded evaluation"}</p>
        <h1>{korean ? <>내 AI가 믿고 사용할 지식,<br />직접 검증하세요.</> : <>Find out what your AI<br />can actually rely on.</>}</h1>
        <p>{korean ? "사용 허가된 작은 문서 묶음과 실제 질문으로 시작합니다. 처리 전에 범위와 비용을 합의하고, 결과와 누락된 근거 및 남은 한계를 함께 확인합니다." : "Start with a small, permitted document set and real questions. Agree on the scope and cost before any processing, then inspect the results, missing evidence, and remaining limitations."}</p>
        <p className="evaluation-gate">{korean ? KO_CHROME.customerDataGate : activationPolicy.customerData.reason}</p>
        <Link href="/explore">{korean ? "먼저 공개 샘플 살펴보기 (영문) ↗" : "Inspect the public sample first ↗"}</Link>
      </section>
      <div className="evaluation-grid">
        <aside>
          <h2>{korean ? "평가 진행 과정" : "What happens next"}</h2>
          <ol className="evaluation-steps">
            <li><strong>{korean ? "해결할 업무 정하기" : "Define the task"}</strong><p>{korean ? "문서 유형, 사용할 AI, 답을 얻고 싶은 질문을 정합니다." : "Document types, intended AI use, and the questions that matter."}</p></li>
            <li><strong>{korean ? "처리 범위 합의하기" : "Agree on boundaries"}</strong><p>{korean ? "허용된 자료, 보관 기간, 처리 위치, 지원 형식과 총비용 상한을 합의합니다." : "Authorized sources, retention, processing location, supported formats, and a total cost ceiling."}</p></li>
            <li><strong>{korean ? "근거 검토하기" : "Review the evidence"}</strong><p>{korean ? "답변을 원문 버전까지 추적합니다. 성공한 결과뿐 아니라 실패, 불확실성, 시간과 비용도 함께 확인합니다." : "Trace answers to their source versions. Report failures, uncertainty, time, and cost alongside successful results."}</p></li>
          </ol>
          <p className="fine">{korean ? "문의를 보내도 자료 처리, 외부 연결, 결제가 시작되지 않습니다." : "An inquiry does not start processing, enable a connection, or create a payment commitment."}</p>
          <p><Link href="/sources">{korean ? "자료 지원 범위 (영문)" : "Source limits"}</Link> · <Link href={korean ? "/ko/pricing" : "/pricing"}>{korean ? "가격과 이용 조건" : "Pricing conditions"}</Link> · <Link href="/trust">{korean ? "데이터 처리 범위 (영문)" : "Data boundaries"}</Link></p>
        </aside>
        <section className="evaluation-form" aria-label="Request a document evaluation">
          <h2>{korean ? "무엇을 검증하고 싶으신가요?" : "Tell us what you want to verify"}</h2>
          <p>{korean ? "필수 항목은 세 개입니다. 간단하게 적어주세요. 자세한 자료 정보는 선택 사항이며, 비공개 문서나 인증 정보는 넣지 마세요." : "Three required fields. Keep the first message short; document details are optional. Please do not include private documents or credentials."}</p>
          <ContactForm locale={korean ? "ko" : "en"} />
        </section>
      </div>
    </main>
    <PublicSiteFooter korean={korean} />
  </div>;
}
