import { EXPLORE_CTA } from "@/lib/site-navigation";

/*
  One next action per scene (§39: "모든 major scene에서 next action 하나 존재"), in both languages.

  These labels are not in `lib/landing-v2-copy.ts` because that module is the blueprint's copy
  deck and this is wiring: which existing route each scene hands the reader on to. Nothing here
  invents a destination -- every href is a route this site already publishes, and the Explore
  action is `EXPLORE_CTA` rather than a second spelling of it (contract rule 6).

  Korean is a literal translation (D12), and where /ko already published a wording for the same
  destination that wording is kept rather than improved: "연결 방식 확인" for /integrations,
  "지식 컴파일러란" for /knowledge-compiler, "공개 Compiled World 열기" for /explore. A reader who
  has seen the old page should meet the same words.
*/
export type SceneAction = { label: string; href: string };

/** The Explore action's Korean label. `KO_CHROME.cta` keys only the two access actions. */
export const KO_EXPLORE_LABEL = "공개 Compiled World 열기";

/** Where a signed-in reader goes instead of the access action. */
export const WORKSPACE_LABEL = { en: "Open workspace", ko: "워크스페이스 열기" } as const;

/** Alt text for the hero source page. No figure in it (contract rule 4). */
export const HERO_PAGE_ALT = {
  en: "A rendered page of the original filing this Compiled World was read from.",
  ko: "이 Compiled World를 읽어 온 원본 공시 문서의 페이지 렌더입니다.",
} as const;

type SceneId = "proof" | "sources" | "evidence" | "recompile" | "why" | "use" | "trust";

export const SCENE_ACTIONS: Record<"en" | "ko", Record<SceneId, SceneAction>> = {
  en: {
    proof: { label: EXPLORE_CTA.label, href: EXPLORE_CTA.href },
    sources: { label: "See what TAVONEL accepts", href: "/sources" },
    evidence: { label: "Open an evidence record", href: "/explore?act=evidence" },
    recompile: { label: "Read the compiler contract", href: "/product/continuous-knowledge" },
    why: { label: "What a Knowledge Compiler is", href: "/knowledge-compiler" },
    use: { label: "See how sources connect", href: "/integrations" },
    trust: { label: "Read the security controls", href: "/security" },
  },
  ko: {
    proof: { label: KO_EXPLORE_LABEL, href: EXPLORE_CTA.href },
    sources: { label: "가져올 수 있는 자료 확인", href: "/sources" },
    evidence: { label: "근거 기록 열기", href: "/explore?act=evidence" },
    recompile: { label: "컴파일러 계약 읽기", href: "/product/continuous-knowledge" },
    why: { label: "지식 컴파일러란", href: "/knowledge-compiler" },
    use: { label: "연결 방식 확인", href: "/integrations" },
    trust: { label: "보안 관리 항목 확인", href: "/security" },
  },
};
