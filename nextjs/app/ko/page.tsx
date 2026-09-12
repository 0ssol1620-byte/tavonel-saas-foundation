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
              <p className="slate"><b>한국어</b><span aria-hidden="true" />· TAVONEL</p>
              <h1 className="document-title">문서는 이미 있습니다.<br />AI가 쓸 수 있게 컴파일하십시오.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                TAVONEL은 회사가 이미 가진 문서와 스캔, 연결된 시스템을 AI가 근거와 함께 쓸 수 있는
                지식으로 컴파일합니다. 컴파일된 결과의 각 항목은 그것이 나온 원문 위치로 되짚어
                갈 수 있습니다.
              </p>
              {/*
                BA-224. The first card was headed "한국어로 있는 것" -- what exists in Korean -- and
                opened "지금 한국어 페이지는 이 한 장입니다": the first thing a Korean buyer read was a
                statement about what we have not built. What they can get is the heading now, and
                the fact about language is one line under the English links at the foot.

                The audit's sentence opened with the product ("TAVONEL은 ... 컴파일합니다"), which is
                the lede two paragraphs above this card word for word. Repeating it here would be
                the same defect in the other direction, so the card carries the half the lede does
                not: that the Korean channel is real, and where the English references are.
              */}
              <div className="tiles">
                <article className="tile">
                  <h3>한국어 문의</h3>
                  <p>
                    도입 검토와 기술 문의는 한국어로 받습니다. 제품과 문서, 요금의 기준 문서는
                    영문이며 아래에서 바로 열립니다.
                  </p>
                </article>
                {/* FD-02 (`docs/policy/DECISION_LOG_2026-09-11.md`): the activation plan gate below is a
                    delegated decision, 2026-09-11; both plan labels come from the catalog. */}
                {/*
                  BA-226. The heading was "시작하기 전에 아는 편이 나은 한 가지" -- one thing you would
                  rather know before you start -- and the body closed "먼저 알아 두는 편이 낫습니다",
                  which frames how we sell as a warning. The heading now states the property, which
                  is a strength of this product rather than a caveat about it.

                  The audit's proposed body said activation opens on the Team plan alone. FD-02
                  made it the Developer plan too when the caller owns the workspace, so that
                  sentence would now under-sell, and `lib/page-seo.test.ts` pins the owner
                  condition and the evaluation's refusal in Korean. Both plan labels are still read
                  from the catalog; the shape is the audit's and the facts are the code's.
                */}
                <article className="tile">
                  <h3>World 활성화는 사람이 승인합니다</h3>
                  <p>
                    컴파일 결과는 후보(candidate)로 남고, 사람이 활성화한 뒤에야 질문에 답합니다.
                    활성화 단계는 유료 플랜에서 열립니다 — 워크스페이스 소유자라면{" "}
                    {DEVELOPER_PLAN.label} 플랜에서, 또는 {TEAM_PLAN.label} 플랜에서 가능하고,
                    {TEAM_PLAN.label} 플랜은 상담을 거쳐 제공됩니다. 무료 평가판은 업로드와 컴파일,
                    검토, 내보내기까지 되고 활성화 요청은 거절됩니다. 요금과 각 플랜의 범위는
                    Pricing 페이지가 기준입니다.
                  </p>
                </article>
              </div>

              {/*
                BA-225. This page ended in prose with one English-labelled inline link inside a
                Korean paragraph, while every English page in the same lens ends in a row of
                buttons -- so a Korean visitor read to the bottom and had nothing to press. The
                third tile was that link; it is this row now (BA-228, which is also why the grid
                above is two cards rather than three).
              */}
              <div className="actions">
                <Link className="btn" href="/contact">문의하기</Link>
                <Link className="btn ghost" href="/explore">공개 샘플 열기</Link>
                <Link className="btn ghost" href="/docs">문서 보기 (EN)</Link>
              </div>

              {/*
                BA-227/228. Six link tiles each carried its own "(EN)" suffix, and they sat in a
                second `.tiles` grid directly against the Korean cards with nothing between them --
                one broken eight-cell grid with a wide row through the middle. One eyebrow marks
                the language for the whole group, and one line under it says where the links go.
              */}
              <p className="slate"><b>ENGLISH</b><span aria-hidden="true" />· 기준 문서</p>
              <div className="tiles">
                {ENGLISH_PAGES.map((page) => (
                  <article className="tile" key={page.href}>
                    <h3><Link href={page.href}>{page.label}</Link></h3>
                    <p>{page.note}</p>
                  </article>
                ))}
              </div>
              <p className="fine">
                링크는 영문 페이지로 연결됩니다. 이 페이지의 영어판 입구는{" "}
                <Link href="/">tavonel.com</Link> 첫 화면이고, 언어는 주소로만 갈립니다. 접속
                위치로 자동 이동시키지 않습니다.
              </p>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
