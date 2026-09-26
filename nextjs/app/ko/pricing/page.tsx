import type { Metadata } from "next";
import Link from "next/link";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import { PublicSitePage } from "@/components/public-site-chrome";
import { activationPolicy } from "@/lib/activation-policy";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { pageMetadata } from "@/lib/page-seo";
import { MAX_UNITS_PER_PAGE, PROCESSING_UNIT_USD, STANDARD_UNITS_PER_PAGE } from "@/lib/usage-pricing";
import DocumentLangKo from "../document-lang";
import styles from "./pricing.module.css";

export const metadata: Metadata = pageMetadata({
  title: "요금과 도입 상담 — TAVONEL",
  description: "TAVONEL의 공개 샘플, Developer·Team 요금, 자료 도입 절차를 확인하세요. 자체 자료 컴파일은 현재 요금제 구매만으로 열리지 않으며 상담 후 설정합니다.",
  canonical: "/ko/pricing",
  languages: { ko: "/ko/pricing", en: "/pricing", "x-default": "/pricing" },
});

const developer = BILLING_OFFERS.observer_access;
const team = BILLING_OFFERS.studio_access;
const standardPageUsd = STANDARD_UNITS_PER_PAGE * PROCESSING_UNIT_USD;
const maximumPageUsd = MAX_UNITS_PER_PAGE * PROCESSING_UNIT_USD;

export default function KoreanPricingPage() {
  return (
    <PublicSitePage korean languageHref="/pricing">
      <DocumentLangKo />
      <BreadcrumbJsonLd trail={[{ name: "한국어 안내", path: "/ko" }, { name: "요금", path: "/ko/pricing" }]} />
      <section className={`scene doc pricing-page ${styles.scene}`} aria-labelledby="ko-pricing-title">
        <div className="shell">
          <div className={styles.content}>
            <div className={styles.intro}>
              <p className="eyebrow">요금</p>
              <h1 className="document-title" id="ko-pricing-title">먼저 확인하고, 맞는 범위로 시작하세요.</h1>
              <p className="lede">완성된 공개 World는 로그인 없이 살펴볼 수 있습니다. 내 자료를 컴파일하는 절차와 요금은 아래에서 확인하고 상담으로 연결할 수 있습니다.</p>
              <div className={styles.actions}>
                <Link className="btn" href="/ko/contact">도입 상담하기</Link>
                <Link className="btn ghost" href="/explore" hrefLang="en">공개 World 확인 (영문)</Link>
              </div>
              {!activationPolicy.customerData.enabled ? (
                <p className="fine">현재 자체 자료 컴파일은 요금제를 구매하는 것만으로 열리지 않습니다. 자료 도입과 첫 컴파일은 상담 후 설정합니다.</p>
              ) : null}
            </div>
            <div className={styles.plans} aria-labelledby="ko-pricing-plans">
              <h2 id="ko-pricing-plans">요금제</h2>
              <div className={styles.grid}>
                <article className={styles.card}>
                  <h3>공개 샘플</h3>
                  <p className={styles.price}>무료</p>
                  <p>완성된 World의 결과와 연결된 원문을 직접 확인합니다. 자체 자료 체험과는 다릅니다.</p>
                  <Link href="/explore" hrefLang="en">공개 World 살펴보기 (영문)</Link>
                </article>
                <article className={styles.card}>
                  <h3>{developer.label}</h3>
                  <p className={styles.price}>${developer.priceUsd}<span className={styles.unit}> /월, USD</span></p>
                  <p>월 {developer.includedPages.toLocaleString("en-US")} 표준 페이지, 증거 연결·Ask·서명된 내보내기, API·MCP 접근.</p>
                  <p className="fine">자체 자료 컴파일은 상담 후 설정합니다.</p>
                  <Link href="/ko/contact?plan=Developer">Developer 도입 상담</Link>
                </article>
                <article className={styles.card}>
                  <h3>{team.label}</h3>
                  <p className={styles.price}>${team.priceUsd}<span className={styles.unit}> /월, USD</span></p>
                  <p>월 {team.includedPages.toLocaleString("en-US")} 표준 페이지, 검토 대기열·버전 기록·자료 도입 안내.</p>
                  <p className="fine">현재 단일 사용자 워크스페이스입니다. 여러 사용자·역할·사용자별 원문 권한은 제공하지 않습니다.</p>
                  <Link href="/ko/contact?plan=Team">Team 도입 상담</Link>
                </article>
                <article className={styles.card}>
                  <h3>Enterprise</h3>
                  <p className={styles.price}>별도 협의</p>
                  <p>자료 범위, 보안 검토, 운영 방식과 계약 조건을 함께 정합니다.</p>
                  <Link href="/ko/contact?plan=Enterprise">Enterprise 도입 상담</Link>
                </article>
              </div>
              <p className={`${styles.terms} fine`}>포함 페이지 초과 시 표준 페이지는 ${standardPageUsd.toFixed(2)}, 복잡한 페이지는 페이지당 최대 ${maximumPageUsd.toFixed(2)}입니다. 처리 전 상한을 확인합니다. 세금·환불·세부 한도와 공식 계약 조건은 <Link href="/pricing" hrefLang="en">영문 요금 안내</Link>에서 확인하세요.</p>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
