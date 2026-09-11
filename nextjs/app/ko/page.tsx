import type { Metadata } from "next";
import Link from "next/link";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import { PublicSitePage } from "@/components/public-site-chrome";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { pageMetadata } from "@/lib/page-seo";

/*
  §12.4 -- the Korean entry point, and only the entry point.

  The blueprint asks for `/ko/...` as separate URLs with a correct self-canonical and hreflang,
  and asks in the same paragraph for the meaning of a few pages to be right in Korean before
  anything is machine-translated wholesale. Those two halves pull in opposite directions if the
  scaffold ships with translated product copy: a page claiming to be the Korean `/pricing` while
  the numbers, plan rules and limits live in one English module would be a second source of
  truth in a second language, and the one that goes stale is the translation.

  So this page translates no claim. It says what the product does, states the one entitlement
  fact a Korean reader would otherwise discover at the end of a signup, and hands over to the
  English pages that are the single source for everything else. Every link below leaves the
  Korean subtree on purpose, and says so.

  What is deliberately absent: a price, a page count, a limit, a date, and any sentence about
  a result. Those are enforced in code on the English pages; restating them here would be a
  copy nobody checks. No geo redirect either -- `middleware.ts` sets security headers and
  routes nothing, and `lib/seo-surface.test.ts` keeps it that way, so a Korean-language visitor
  who wants the English page gets the English page.
*/

const TEAM_PLAN = BILLING_OFFERS.studio_access;
const DEVELOPER_PLAN = BILLING_OFFERS.observer_access;

export const metadata: Metadata = pageMetadata({
  title: "한국어 안내 — TAVONEL",
  description:
    "TAVONEL이 무엇을 컴파일하는지, 시작하려면 무엇이 필요한지를 한국어로 정리한 입구 페이지입니다. 제품과 문서, 요금의 단일 기준은 영문 페이지이며 여기서 바로 연결됩니다.",
  canonical: "/ko",
  /*
    One true pair, not a translated sitemap. `/ko` and `/` are each the entry point of the site
    in their own language, so that is the pair this page annotates; `x-default` is the English
    entry because it is the one with the whole site behind it. Adding rows for pages that have
    no Korean counterpart would point hreflang at documents that do not exist.
  */
  languages: { ko: "/ko", en: "/", "x-default": "/" },
});

const ENGLISH_PAGES: Array<{ href: "/product" | "/docs" | "/pricing" | "/sources" | "/security" | "/explore"; label: string; note: string }> = [
  { href: "/product", label: "Product", note: "문서 이해, 컴파일, 근거, Compiled World이 각각 무엇을 하는지." },
  { href: "/docs", label: "Documentation", note: "API와 MCP, 지원 형식, 검수, 내보내기의 정확한 계약." },
  { href: "/pricing", label: "Pricing", note: "요금과 포함 범위, 시작 조건의 단일 기준." },
  { href: "/sources", label: "Sources", note: "이 배포가 실제로 받는 형식과, 컴파일 이후 남는 것과 남지 않는 것." },
  { href: "/security", label: "Security", note: "문서가 지나가는 경로, 테넌트 분리, 보관과 삭제." },
  { href: "/explore", label: "Explore", note: "로그인 없이 공개 샘플에서 결과를 원문 위치까지 되짚어 보는 화면." },
];

export default function KoreanEntryPage() {
  return (
    <PublicSitePage>
      <BreadcrumbJsonLd trail={[{ name: "한국어 안내", path: "/ko" }]} />
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>한국어</b><span />TAVONEL</p>
              <h1 className="document-title">문서는 이미 있습니다.<br />AI가 쓸 수 있게 컴파일하십시오.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                TAVONEL은 회사가 이미 가진 문서와 스캔, 연결된 시스템을 AI가 근거와 함께 쓸 수 있는
                지식으로 컴파일합니다. 컴파일된 결과의 각 항목은 그것이 나온 원문 위치로 되짚어
                갈 수 있습니다.
              </p>
              <div className="tiles">
                <article className="tile">
                  <h3>한국어로 있는 것</h3>
                  <p>
                    지금 한국어 페이지는 이 한 장입니다. 아래 링크는 번역본이 아니라 영문 원문으로
                    바로 갑니다. 제품 설명과 문서, 요금은 각각 코드가 강제하는 하나의 기준에서
                    나오고, 그 기준은 영문 페이지에 있습니다.
                  </p>
                </article>
                {/* FD-02 (`docs/policy/DECISION_LOG_2026-09-11.md`): the activation plan gate below is a
                    delegated decision, 2026-09-11; both plan labels come from the catalog. */}
                <article className="tile">
                  <h3>시작하기 전에 아는 편이 나은 한 가지</h3>
                  <p>
                    사람이 승인한 World를 활성화하는 단계는 유료 플랜에서 열립니다. 워크스페이스
                    소유자라면 {DEVELOPER_PLAN.label} 플랜에서, 또는 {TEAM_PLAN.label} 플랜에서
                    가능합니다. {TEAM_PLAN.label} 플랜은 오늘 상담을 거쳐 제공됩니다. 무료 평가판은
                    업로드와 컴파일, 검토, 내보내기까지 되지만 활성화 요청은 거절됩니다. 요금과 각
                    플랜의 범위는 Pricing 페이지가 기준입니다.
                  </p>
                </article>
                <article className="tile">
                  <h3>문의</h3>
                  <p>
                    도입 범위나 {TEAM_PLAN.label} 플랜을 이야기하려면 <Link href="/contact">Contact</Link> 로
                    보내 주십시오. 한국어로 보내도 됩니다.
                  </p>
                </article>
              </div>
              <div className="tiles">
                {ENGLISH_PAGES.map((page) => (
                  <article className="tile" key={page.href}>
                    <h3><Link href={page.href}>{page.label}</Link> <span lang="en">(EN)</span></h3>
                    <p>{page.note}</p>
                  </article>
                ))}
              </div>
              <p className="fine">
                이 페이지의 영어판 입구는 <Link href="/">tavonel.com</Link> 첫 화면입니다. 언어는
                주소로만 갈립니다. 접속 위치로 자동 이동시키지 않습니다.
              </p>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
