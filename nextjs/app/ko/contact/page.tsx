import type { Metadata } from "next";
import Link from "next/link";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import ContactForm from "@/components/contact-form";
import { PublicSitePage } from "@/components/public-site-chrome";
import { KO_CHROME } from "@/lib/site-navigation";
import { readLegalOperator } from "@/lib/legal-operator";
import { pageMetadata } from "@/lib/page-seo";
import DocumentLangKo from "../document-lang";

export const metadata: Metadata = pageMetadata({
  title: "이용 문의 — TAVONEL",
  description: "자료를 보내지 않고 해결하려는 일과 필요한 범위를 알려주세요. TAVONEL이 적용 가능한 절차를 안내합니다.",
  canonical: "/ko/contact",
  languages: { ko: "/ko/contact", en: "/contact", "x-default": "/contact" },
});

export default function KoreanContactPage() {
  const operator = readLegalOperator();
  return (
    <PublicSitePage korean languageHref="/contact">
      <DocumentLangKo />
      <BreadcrumbJsonLd trail={[{ name: "한국어 안내", path: "/ko" }, { name: "이용 문의", path: "/ko/contact" }]} />
      <section className="scene doc contact-page">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <h1 className="document-title">도입을 함께 검토합니다.</h1>
              <p className="lede">자료가 어디에 흩어져 있고, 누가 어떤 AI에서 사용해야 하는지 알려주세요. 적용 범위와 다음 단계를 함께 확인합니다.</p>
              <p className="fine">{KO_CHROME.customerDataGate}</p>
            </div>
            <div className="stack">
              <h2>이용 문의</h2>
              <p className="lede">아래 선택 질문에 답하면 자료와 사용 목적을 더 구체적으로 파악할 수 있습니다. 고객 문서나 민감한 원문은 보내지 마세요.</p>
              <ContactForm locale="ko" />
              <div className="contact-address">
                <span>일반 문의</span>
                <a className="link" href="mailto:hello@tavonel.com">hello@tavonel.com</a>
              </div>
              <div className="contact-address">
                <span>제품 지원</span>
                <a className="link" href="mailto:support@tavonel.com">support@tavonel.com</a>
              </div>
              <div className="contact-address">
                <span>보안 취약점 제보</span>
                <a className="link" href="mailto:security@tavonel.com">security@tavonel.com</a>
              </div>
              {operator ? (
                <div className="contact-address">
                  <span>전화</span>
                  <a className="link" href={`tel:${operator.phone}`}>{operator.phone}</a>
                </div>
              ) : null}
              <p className="fine">요금과 제공 범위는 <Link href="/ko/pricing">요금 안내</Link>에서 확인할 수 있습니다. <Link href="/explore" hrefLang="en">공개 World (영문)</Link>는 로그인 없이 살펴볼 수 있습니다.</p>
              <p className="fine">보안과 개인정보 처리는 <Link href="/security" hrefLang="en">보안 안내 (영문)</Link>에 설명되어 있습니다.</p>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
