import type { Metadata, Route } from "next";
import Link from "next/link";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import { PublicSitePage } from "@/components/public-site-chrome";
import PricingPlanOverview, { pricingPlanDestinationClass, pricingPlanId } from "@/components/pricing-plan-overview";
import { activationPolicy } from "@/lib/activation-policy";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { loginUrlForOffer } from "@/lib/checkout-intent";
import { primaryCallToAction } from "@/lib/commercial-state";
import { pageMetadata } from "@/lib/page-seo";
import { readPublicStatusV2 } from "@/lib/public-status";
import { ACCESS_CTA, KO_CHROME, SELF_SERVE_CTA } from "@/lib/site-navigation";
import { MAX_UNITS_PER_PAGE, STANDARD_UNITS_PER_PAGE } from "@/lib/usage-pricing";
import DocumentLangKo from "../document-lang";
import styles from "./pricing.module.css";

export const metadata: Metadata = pageMetadata({
  title: "요금과 도입 상담 — TAVONEL",
  description: "TAVONEL의 공개 샘플, Developer·Team 요금, 내 원문 컴파일을 시작하는 방법을 확인하세요. Developer와 Team은 워크스페이스가 열리면 온라인으로 구매하고, Enterprise는 상담으로 시작합니다.",
  canonical: "/ko/pricing",
  languages: { ko: "/ko/pricing", en: "/pricing", "x-default": "/pricing" },
});

const developer = BILLING_OFFERS.observer_access;
const team = BILLING_OFFERS.studio_access;
// Reuse the existing Korean card presentation in the overview, including its public-sample posture.
const publicSample = { name: "공개 샘플", price: "무료", unit: "" };
const enterprise = { name: "Enterprise", price: "별도 협의", unit: "" };
const monthlyUnit = "/월, USD";
const planSummaries = [
  publicSample,
  { name: developer.label, price: `$${developer.priceUsd}`, unit: monthlyUnit },
  { name: team.label, price: `$${team.priceUsd}`, unit: monthlyUnit },
  enterprise,
];
/* R1, delegated decision 2026-11-09: no per-page price past the plan; a complex page is stated in allowance terms. */
const complexPageMaxStandardPages = MAX_UNITS_PER_PAGE / STANDARD_UNITS_PER_PAGE;

export default function KoreanPricingPage() {
  /*
    P2-10 (JOURNEY-MAP D-07, A5). This page wrote `/ko/contact` into both of the actions that
    change with the commercial state, so on the day a plan could be bought the English page would
    offer checkout while this one kept sending the same buyer to a consultation. The intro reads
    the site's access action and the Developer card reads `purchasePlan`, the same answer
    `/pricing` reads. While both are closed -- today -- the two branches below print exactly what
    this page printed before (`lib/cta-truth.test.ts` pins it).

    The open branch reuses existing Korean strings rather than writing pricing copy: the S2 Korean
    wording is founder decision D-07, set in P2-37 before the switch moves.
  */
  const access = primaryCallToAction();
  const intro = access.href === ACCESS_CTA.href
    ? { href: "/ko/contact", label: "도입 상담하기" }
    : { href: access.href, label: KO_CHROME.cta[access.href] ?? access.label };
  const purchaseOpen = readPublicStatusV2().availableActions.purchasePlan.enabled;
  return (
    <PublicSitePage template="T2" korean>
      <DocumentLangKo />
      <BreadcrumbJsonLd trail={[{ name: "한국어 안내", path: "/ko" }, { name: "요금", path: "/ko/pricing" }]} />
      <section className={`scene doc pricing-page ${styles.scene}`} aria-labelledby="ko-pricing-title">
        <div className="shell">
          <div className={styles.content}>
            <div className={styles.intro}>
              <p className="eyebrow">요금</p>
              <h1 className="document-title" id="ko-pricing-title">먼저 확인하고, 맞는 범위로 시작하세요.</h1>
              <p className="lede">완성된 공개 World는 로그인 없이 살펴볼 수 있습니다. 로그인하면 워크스페이스가 만들어지고, 처리 약관에 동의하면 내 원문 컴파일이 열립니다. 열림 상태는 워크스페이스 화면에 표시됩니다. 요금제와 포함 페이지는 아래에 있습니다.</p>
              <div className={styles.actions}>
                <Link className="btn" href={intro.href as Route}>{intro.label}</Link>
                <Link className="btn ghost" href="/explore" hrefLang="en">공개 World 확인 (영문)</Link>
              </div>
              {!activationPolicy.customerData.enabled ? (
                <p className="fine">현재 자체 자료 컴파일은 요금제를 구매하는 것만으로 열리지 않습니다. 도입 가능 여부와 시범 운영 범위를 상담으로 확인합니다.</p>
              ) : null}
            </div>
            <div className={styles.plans} aria-labelledby="ko-pricing-plans">
              <h2 id="ko-pricing-plans">요금제</h2>
              <PricingPlanOverview plans={planSummaries} korean />
              <div className={styles.grid}>
                <article className={`${styles.card} ${pricingPlanDestinationClass}`} id={pricingPlanId(0)} tabIndex={-1}>
                  <h3>{publicSample.name}</h3>
                  <p className={styles.price}>{publicSample.price}</p>
                  <p>완성된 World의 결과와 연결된 원문을 직접 확인합니다. 자체 자료 체험과는 다릅니다.</p>
                  <Link href="/explore" hrefLang="en">공개 World 살펴보기 (영문)</Link>
                </article>
                <article className={`${styles.card} ${pricingPlanDestinationClass}`} id={pricingPlanId(1)} tabIndex={-1}>
                  <h3>{developer.label}</h3>
                  <p className={styles.price}>${developer.priceUsd}<span className={styles.unit}> {monthlyUnit}</span></p>
                  <p>월 {developer.includedPages.toLocaleString("en-US")} 표준 페이지, 증거 연결·Ask·서명된 내보내기, API·MCP 접근.</p>
                  <p className="fine">내 원문 컴파일은 워크스페이스의 처리 승인 뒤에 시작합니다.</p>
                  {purchaseOpen ? (
                    <Link href={loginUrlForOffer("observer_access") as Route}>{developer.label} · {KO_CHROME.cta[SELF_SERVE_CTA.href]}</Link>
                  ) : (
                    <Link href="/ko/contact?plan=Developer">Developer 도입 상담</Link>
                  )}
                </article>
                <article className={`${styles.card} ${pricingPlanDestinationClass}`} id={pricingPlanId(2)} tabIndex={-1}>
                  <h3>{team.label}</h3>
                  <p className={styles.price}>${team.priceUsd}<span className={styles.unit}> {monthlyUnit}</span></p>
                  <p>월 {team.includedPages.toLocaleString("en-US")} 표준 페이지, 검토 대기열·버전 기록·자료 도입 안내.</p>
                  <p className="fine">현재 단일 사용자 워크스페이스입니다. 여러 사용자·역할·사용자별 원문 권한은 제공하지 않습니다.</p>
                  {purchaseOpen ? (
                    <Link href={loginUrlForOffer("studio_access") as Route}>{team.label} · {KO_CHROME.cta[SELF_SERVE_CTA.href]}</Link>
                  ) : (
                    <Link href="/ko/contact?plan=Team">Team 도입 상담</Link>
                  )}
                </article>
                <article className={`${styles.card} ${pricingPlanDestinationClass}`} id={pricingPlanId(3)} tabIndex={-1}>
                  <h3>{enterprise.name}</h3>
                  <p className={styles.price}>{enterprise.price}</p>
                  <p>자료 범위, 보안 검토, 운영 방식과 계약 조건을 함께 정합니다.</p>
                  <Link href="/ko/contact?plan=Enterprise">Enterprise 도입 상담</Link>
                </article>
              </div>
              <p className={`${styles.terms} fine`}>포함 페이지를 넘는 분량은 저희와 상담해 정합니다. 복잡한 페이지 한 쪽은 포함 페이지를 최대 {complexPageMaxStandardPages}쪽까지 사용하며, 처리 전 상한을 확인합니다. 세금·환불·세부 한도와 공식 계약 조건은 <Link href="/pricing" hrefLang="en">영문 요금 안내</Link>에서 확인하세요.</p>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
