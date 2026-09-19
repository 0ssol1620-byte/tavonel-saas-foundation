import { EXPLORE_CTA } from "@/lib/site-navigation";

/*
  One next action per scene (§39: "모든 major scene에서 next action 하나 존재"), in both languages.

  These labels are not in `lib/landing-v2-copy.ts` because that module is the blueprint's copy
  deck and this is wiring: which existing route each scene hands the reader on to. Nothing here
  invents a destination -- every href is a route this site already publishes, and the Explore
  action is `EXPLORE_CTA` rather than a second spelling of it (contract rule 6).

  Korean is a literal translation (D12), and where /ko already published a wording for the same
  destination that wording is kept rather than improved: "지식 컴파일러란" for /knowledge-compiler,
  "공개 Compiled World 열기" for /explore. A reader who has seen the old page should meet the same
  words.

  ONLY THREE SCENES READ THIS TABLE, AND THAT IS WHY IT HOLDS THREE ENTRIES.

  It held seven while the P0 skeleton rendered eight scenes from one shell. Scenes 03, 04, 07 and
  08 now own their own next action, and four of those rows had already drifted away from what the
  scene actually renders -- `sources` said /sources where the scene links /explore?act=world, and
  `use` said /integrations where the scene links /docs/use-with-ai. A wiring table that disagrees
  with the wiring is worse than no table, so the rows without a consumer are gone rather than
  left standing as a second, wrong spelling of a destination.
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

/** Scene 02's action, Scene 06's action, and the compiler contract Scene 06 cites beside it. */
type SceneId = "proof" | "recompile" | "why";

export const SCENE_ACTIONS: Record<"en" | "ko", Record<SceneId, SceneAction>> = {
  en: {
    proof: { label: EXPLORE_CTA.label, href: EXPLORE_CTA.href },
    recompile: { label: "Read the compiler contract", href: "/product/continuous-knowledge" },
    why: { label: "What a Knowledge Compiler is", href: "/knowledge-compiler" },
  },
  ko: {
    proof: { label: KO_EXPLORE_LABEL, href: EXPLORE_CTA.href },
    recompile: { label: "컴파일러 계약 읽기", href: "/product/continuous-knowledge" },
    why: { label: "지식 컴파일러란", href: "/knowledge-compiler" },
  },
};
