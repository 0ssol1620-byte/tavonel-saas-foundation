import type { Metadata } from "next";
import { cookies } from "next/headers";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import LandingPage, { HERO_IMAGE_SIZES, heroScene } from "@/components/landing-v2/landing-page";
import DocumentLangKo from "./document-lang";
import { LANDING_VARIANT_COOKIE, LANDING_VARIANT_QUERY, landingVariantState } from "@/lib/landing-experiments";
import { pageMetadata } from "@/lib/page-seo";
import { KO_CHROME } from "@/lib/site-navigation";

/*
  한국어 진입 페이지. Landing V2, 2026-09-19.

  영문 `/`와 같은 컴포지션을 한국어 로캘로 렌더한다. 아홉 개 장면, 같은 id, 같은 순서이며,
  모든 문장은 `lib/landing-v2-copy.ts`의 한국어 카피 — D12에 따라 영문을 그대로 옮긴 번역이고
  새로운 주장은 없다. 화면에 나오는 숫자는 전부 컴파일된 공개 World에서 읽어 온 값이다.

  이 페이지는 더 이상 영상을 재생하지 않는다. 잠긴 네 컷은 그대로 남아 있고 /film이 재생한다.

  `app/ko/layout.tsx`는 2026-09-19 수정 2차에서 삭제했다. 그 레이아웃은 `<div lang="ko">`
  하나만 렌더했는데, `LandingPage`가 이미 `.page`에 `lang="ko"`를 붙이고 `DocumentLangKo`가
  마운트 시 문서 루트의 `lang`을 바꾼다. 남은 것은 `body > div[lang=ko] > div.page` 라는 한
  겹 더 깊은 구조뿐이었고, 영문 `/`는 `body > div.page`였다 — 같은 페이지의 두 로캘이 서로
  다른 문서 형태를 가지게 되어 랜드마크 감사가 `/ko`에서만 실패했다. 아무 일도 하지 않는
  래퍼를 없애는 쪽이 감사를 로캘별로 나누는 쪽보다 옳다.
*/

export const dynamic = "force-dynamic";
/*
  탭 제목은 영문 `/`의 `TAVONEL — ${BRAND_LINE.descriptor}`를 그대로 옮긴 것이다.

  이전 제목 "내 자료를 AI가 사용하는 지식으로 — TAVONEL"에는 두 가지 문제가 있었다. 첫째,
  영문 제목의 번역이 아니라 별도의 문장이어서 D12(한국어는 문자 그대로의 번역이며 새 주장을
  하지 않는다)에 어긋났다. 둘째, 이 배포판은 아직 고객의 파일을 컴파일하지 않는데
  (`activationPolicy.customerData.enabled === false`) 검색 결과에 그 기능을 아무 조건 없이
  약속하는 문장으로 노출됐다. `KO_CHROME.tagline`은 `BRAND_LINE.descriptor`의 한국어 번역이고
  푸터가 이미 그 문장을 쓰고 있다 — 제목이 여섯 번째 포지셔닝 문장을 새로 쓰지 않는다.
*/
export const metadata: Metadata = pageMetadata({
  title: `TAVONEL — ${KO_CHROME.tagline}`,
  description: "TAVONEL은 지식 컴파일러입니다. 컴파일된 모든 결과는 읽어 온 페이지까지 되짚어 갈 수 있는 경로를 유지합니다. 공개 Compiled World를 지금 전체 열람할 수 있습니다.",
  canonical: "/ko",
  languages: { ko: "/ko", en: "/", "x-default": "/" },
});

/** Korean entry, not a claim that the technical and legal documentation is translated. */
/*
  D8. 실험 진영(arm)은 영문 `/`와 똑같이 서버에서 읽는다 — 쿠키 `tavonel.lp-variant`와 `?lp=`.
  실험이 꺼져 있으면(기본값) 쿠키는 존재하지 않고 언제나 arm "a"이며, 어떤 이벤트에도 `variant`
  속성이 붙지 않는다. 두 진입 페이지가 같은 함수를 쓰므로 한쪽만 다른 헤드라인을 보일 수 없다.
*/
export default async function KoreanEntryPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = (await searchParams)?.[LANDING_VARIANT_QUERY];
  const experiment = landingVariantState({
    cookie: (await cookies()).get(LANDING_VARIANT_COOKIE)?.value,
    query: Array.isArray(query) ? query[0] : query,
  });
  const hero = heroScene();
  return (
    <>
      {/* 영문 페이지와 같은 LCP 리소스: 히어로가 그리는 READ 스트립(영역 크롭), 같은 srcset과 sizes. */}
      <link
        rel="preload"
        as="image"
        href={hero.region.cropSrc}
        imageSrcSet={hero.region.cropSrcSet}
        imageSizes={HERO_IMAGE_SIZES}
        fetchPriority="high"
      />
      <LandingPage korean experiment={experiment}>
        <DocumentLangKo />
        <BreadcrumbJsonLd trail={[{ name: "한국어 안내", path: "/ko" }]} />
      </LandingPage>
    </>
  );
}
