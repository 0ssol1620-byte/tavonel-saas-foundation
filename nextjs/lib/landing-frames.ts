/**
 * The three product frames on the landing page (`/` and `/ko`).
 *
 * Each is a screenshot of the public `/explore` route -- the published Apple SEC Compiled World --
 * taken on the date below from a production build, with no retouching. `href` is the view the
 * frame shows, so a reader can open the same screen. The captions describe what is on the frame
 * and nothing more: no count, no rate, no claim the frame does not itself display.
 *
 * `lib/landing-frames.test.ts` checks that every file exists at the declared size and that no
 * caption or alt text carries a digit-bearing figure.
 */
export type LandingFrame = {
  /** The /explore view this frame is a screenshot of. */
  href: string;
  /** ISO date of the capture. */
  captured: string;
  alt: string;
  caption: string;
  ko: { alt: string; caption: string };
  desktop: { src: string; width: number; height: number };
  phone: { src: string; width: number; height: number };
};

export const LANDING_FRAMES: Record<"compile" | "verify" | "recompile", LandingFrame> = {
  compile: {
    href: "/explore?act=world",
    captured: "2026-09-18",
    alt: "The World view on /explore: the compiled objects of the Apple SEC filings and the relations between them, each object linked to the page it was read from.",
    caption: "The World view: the published Apple SEC World on /explore, as it renders today.",
    ko: {
      alt: "/explore의 World 화면: Apple SEC 공시에서 컴파일된 객체들과 그 사이의 관계가 보이고, 각 객체는 읽어 온 페이지와 연결되어 있습니다.",
      caption: "World 화면: 지금 /explore에서 열리는 공개 Apple SEC World.",
    },
    desktop: { src: "/landing/compile-1440.webp", width: 2880, height: 1400 },
    phone: { src: "/landing/compile-390.webp", width: 1170, height: 1560 },
  },
  verify: {
    href: "/explore?act=evidence",
    captured: "2026-09-18",
    alt: "The evidence view on /explore: a compiled passage on one side and the original filing page on the other, with the region it was read from outlined.",
    caption: "The evidence view: the passage, the original page, and the box it was read from.",
    ko: {
      alt: "/explore의 증거 화면: 한쪽에 컴파일된 문단, 다른 쪽에 원문 공시 페이지가 있고 읽어 온 영역이 표시되어 있습니다.",
      caption: "증거 화면: 문단, 원문 페이지, 그리고 읽어 온 영역.",
    },
    desktop: { src: "/landing/verify-1440.webp", width: 2880, height: 1400 },
    phone: { src: "/landing/verify-390.webp", width: 1170, height: 1560 },
  },
  recompile: {
    href: "/explore?act=change",
    captured: "2026-09-18",
    alt: "The change view on /explore: a later snapshot of the World compared with the one before it, showing what a changed source reached.",
    caption: "The change view: one snapshot against the one before it.",
    ko: {
      alt: "/explore의 변경 화면: World의 나중 스냅샷을 이전 스냅샷과 비교해, 바뀐 원문이 어디까지 영향을 미쳤는지 보여 줍니다.",
      caption: "변경 화면: 한 스냅샷과 그 이전 스냅샷의 비교.",
    },
    desktop: { src: "/landing/recompile-1440.webp", width: 2880, height: 1400 },
    phone: { src: "/landing/recompile-390.webp", width: 1170, height: 1560 },
  },
};
