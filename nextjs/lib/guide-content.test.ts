import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DOCS_SECTIONS } from "./docs-content";
import { DEEP_LINK_ACTS } from "./explore-story";
import { GUIDE, GUIDE_UI, GUIDE_VIDEOS, GUIDE_VIDEO_VARIANTS, guideMediaBlock, guideText, guideVideoFiles, type GuideLanguage } from "./guide-content";
import { koTermDrift } from "./ko-terms";
import { tocEntries } from "../components/docs/page-toc";

/*
  The product guide's guards (EN-1, ENABLEMENT-GAP-2026-10-17 §4a "완료 기준").

  - every link resolves, against the route tree rather than a list kept beside it;
  - each chapter exists in English and Korean, as the same chapter;
  - every live quote is live, verbatim, somewhere in the source tree;
  - no "verified" and no "accuracy" in the guide's own voice;
  - every number outside a quote is on an allow-list that names where it comes from;
  - the chapter list itself, as a snapshot.

  Each guard has a planted failure beside it, so a guard that stopped matching anything shows up
  as a red test instead of a quiet green one.
*/

vi.mock("next/navigation", () => ({
  usePathname: () => "/guide",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {} }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

const { GuideMedia, guideVideoReady, vttCueText } = await import("../components/guide/guide-media");
const { default: EnglishGuide } = await import("../app/guide/page");
const { default: KoreanGuide } = await import("../app/ko/guide/page");
const { default: DocsSectionPage } = await import("../app/docs/[section]/page");
const { default: ApiReferencePage } = await import("../app/api/page");

const nextjs = resolve(import.meta.dirname, "..");
const app = join(nextjs, "app");
const LANGUAGES: GuideLanguage[] = ["en", "ko"];

/* ---------------------------------------------------------------------------- routes */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** The fragments a page's source tree can answer: every literal `id="…"` under app/ and components/. */
const LITERAL_IDS = new Set(
  [...walk(app), ...walk(join(nextjs, "components"))]
    .filter((file) => /\.tsx$/.test(file))
    .flatMap((file) => [...readFileSync(file, "utf8").matchAll(/\bid="([a-z0-9-]+)"/g)].map((match) => match[1]!)),
);

/**
 * Why an href does not resolve, or null when it does.
 *
 * A path is a route when `app/<path>/page.tsx` or `route.ts` exists, when it is a `/docs/<slug>`
 * the docs data generates, or when `public/<path>` is a file. A fragment must be a heading the
 * docs section derives (`tocEntries`), or a literal id in the source. `/explore?act=` must be a
 * deep-link act the stage knows.
 */
function unresolved(href: string): string | null {
  if (href.startsWith("mailto:")) return /^mailto:[a-z]+@tavonel\.com(\?subject=.+)?$/.test(href) ? null : "not a tavonel.com address";
  if (!href.startsWith("/")) return "not a site path";
  const [beforeHash, fragment] = href.split("#");
  const [path, query] = beforeHash!.split("?");
  const docs = /^\/docs\/([a-z0-9-]+)$/.exec(path!);
  const section = docs ? DOCS_SECTIONS.find((candidate) => candidate.slug === docs[1]) : undefined;
  const isRoute =
    Boolean(section) ||
    existsSync(join(app, path!, "page.tsx")) ||
    existsSync(join(app, path!, "route.ts")) ||
    (existsSync(join(nextjs, "public", path!)) && statSync(join(nextjs, "public", path!)).isFile());
  if (!isRoute) return "no page, route handler or public file";
  if (query !== undefined) {
    const act = new URLSearchParams(query).get("act");
    if (path !== "/explore" || act === null || !Object.hasOwn(DEEP_LINK_ACTS, act)) return `query ${query} names nothing`;
  }
  if (fragment !== undefined) {
    if (section) {
      const headings = section.blocks.flatMap((block) => (block.kind === "heading" ? [block.text] : []));
      if (!tocEntries(headings).some((entry) => entry.id === fragment)) return `#${fragment} is not a heading of /docs/${section.slug}`;
    } else if (!LITERAL_IDS.has(fragment)) {
      return `#${fragment} is not an id in the source`;
    }
  }
  return null;
}

const allLinks = LANGUAGES.flatMap((language) =>
  GUIDE[language].flatMap((chapter) => chapter.links.map((link) => ({ language, chapter: chapter.id, href: link.href }))),
);

describe("every guide link resolves", () => {
  it("has links to check", () => {
    expect(allLinks.length).toBeGreaterThan(20);
  });

  it.each(allLinks)("$language $chapter → $href", ({ href }) => {
    expect(unresolved(href)).toBeNull();
  });

  it("refuses what does not exist", () => {
    expect(unresolved("/no-such-page")).not.toBeNull();
    expect(unresolved("/docs/no-such-section")).not.toBeNull();
    expect(unresolved("/docs/mcp#no-such-heading")).not.toBeNull();
    expect(unresolved("/pricing#no-such-id")).not.toBeNull();
    expect(unresolved("/explore?act=nothing")).not.toBeNull();
    expect(unresolved("mailto:someone@example.com")).not.toBeNull();
    expect(unresolved("/docs/mcp#registering-it-with-a-client")).toBeNull();
    expect(unresolved("/developer/channel.json")).toBeNull();
  });

  it("is checked on the rendered pages too, every internal href in them", () => {
    for (const [route, page] of [["/guide", EnglishGuide], ["/ko/guide", KoreanGuide]] as const) {
      const html = renderToStaticMarkup(createElement(page));
      const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
      const inGuide = hrefs.filter((href) => href.startsWith("#"));
      for (const href of inGuide) expect(html, `${route} links ${href} with no target`).toContain(`id="${href.slice(1)}"`);
      const chapterLinks = new Set(GUIDE[route === "/guide" ? "en" : "ko"].flatMap((chapter) => chapter.links.map((link) => link.href)));
      for (const href of chapterLinks) expect(hrefs, `${route} does not render ${href}`).toContain(href);
    }
  });
});

/* --------------------------------------------------------------------------- languages */

describe("each chapter exists in English and Korean", () => {
  it("as the same chapters, in the same order", () => {
    expect(GUIDE.ko.map((chapter) => chapter.id)).toEqual(GUIDE.en.map((chapter) => chapter.id));
    expect(new Set(GUIDE.en.map((chapter) => chapter.id)).size).toBe(GUIDE.en.length);
  });

  /*
    Copy-trace: the Korean is the English translated block for block (D12), so the two have the
    same shape -- the same block kinds in the same order, the same number of steps and rows, the
    same recording in the same place, and at least as many links (a Korean chapter may add the
    /ko page beside an English-only one).
  */
  it.each(GUIDE.en.map((chapter, index) => [chapter.id, index] as const))("%s has the same shape in both", (_id, index) => {
    const en = GUIDE.en[index]!;
    const ko = GUIDE.ko[index]!;
    expect(ko.title.trim()).not.toBe("");
    expect(ko.title).not.toBe(en.title);
    expect(ko.blocks.map((block) => block.kind)).toEqual(en.blocks.map((block) => block.kind));
    en.blocks.forEach((block, position) => {
      const other = ko.blocks[position]!;
      if (block.kind === "steps" && other.kind === "steps") expect(other.items.length).toBe(block.items.length);
      if (block.kind === "table" && other.kind === "table") expect(other.rows.length).toBe(block.rows.length);
      if (block.kind === "media" && other.kind === "media") expect(other.video).toBe(block.video);
    });
    expect(ko.links.length).toBeGreaterThanOrEqual(en.links.length);
    expect(en.links.length).toBeGreaterThan(0);
  });

  it("spells the Korean with the term table", () => {
    expect(koTermDrift(guideText("ko").join("\n"))).toEqual([]);
  });

  it("is a chapter list that matches the report, 0 to 13 and the appendix", () => {
    expect(GUIDE.en.map((chapter) => `${chapter.id} | ${chapter.title}`)).toMatchInlineSnapshot(`
      [
        "what-this-guide-covers | What this guide covers",
        "what-tavonel-makes | What TAVONEL makes",
        "open-the-public-world | Open the public World",
        "read-the-evidence | Read the evidence",
        "see-what-changed | See what changed",
        "relations | Relations",
        "verify-a-signed-package | Verify a signed package",
        "call-the-api-without-a-key | Call the API without a key",
        "get-the-developer-files | Get the developer files",
        "connect-the-mcp-bridge | Connect the MCP bridge",
        "estimate-a-cost | Estimate a cost",
        "status-and-trust | Status and trust",
        "start-with-your-files | Start with your files",
        "getting-help | Getting help",
        "glossary | Glossary and revision log",
      ]
    `);
    expect(GUIDE.ko.map((chapter) => `${chapter.id} | ${chapter.title}`)).toMatchInlineSnapshot(`
      [
        "what-this-guide-covers | 이 가이드가 다루는 것",
        "what-tavonel-makes | TAVONEL이 만드는 것",
        "open-the-public-world | 공개 World 열기",
        "read-the-evidence | 근거 읽기",
        "see-what-changed | 변경 보기",
        "relations | 관계 보기",
        "verify-a-signed-package | 서명 패키지 검증",
        "call-the-api-without-a-key | 키 없이 API 호출",
        "get-the-developer-files | 개발자 파일 받기",
        "connect-the-mcp-bridge | MCP 브리지 연결",
        "estimate-a-cost | 비용 미리 보기",
        "status-and-trust | 상태와 신뢰",
        "start-with-your-files | 내 파일로 시작하려면",
        "getting-help | 도움 받기",
        "glossary | 용어집과 개정 이력",
      ]
    `);
  });
});

/* ------------------------------------------------------------------------------ quotes */

const QUOTE = /“([^”]+)”/g;
const quotesIn = (text: string) => [...text.matchAll(QUOTE)].map((match) => match[1]!);
const withoutQuotes = (text: string) => text.replace(QUOTE, " ");

/* Where a live sentence can live. The guide's own files and every test are not a source. */
const SOURCE_TEXT = [
  ...["app", "components", "lib", "content", "public/developer"].flatMap((dir) => walk(join(nextjs, dir))),
  ...walk(resolve(nextjs, "../shared")),
]
  .filter((file) => /\.(tsx?|mjs|json|py)$/.test(file) && !/\.test\./.test(file) && !/guide-content\.ts$|guide-page\.tsx$/.test(file))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")
  // JSX wraps a sentence across lines, and the browser collapses that back to a single space.
  .replace(/\s+/g, " ");

const isLive = (quote: string) => {
  const sentence = quote.replace(/\s+/g, " ");
  return SOURCE_TEXT.includes(sentence) || SOURCE_TEXT.includes(sentence.replace(/'/g, "\\'"));
};

describe("every quoted sentence is live text", () => {
  const quotes = [...new Set(LANGUAGES.flatMap((language) => guideText(language).flatMap(quotesIn)))];

  it("has quotes to check, in both languages", () => {
    expect(quotes.length).toBeGreaterThan(12);
    expect(guideText("ko").flatMap(quotesIn).some((quote) => /[가-힣]/.test(quote))).toBe(true);
  });

  it.each(quotes)("“%s”", (quote) => {
    expect(isLive(quote), "quoted in the guide and found nowhere in app, components, lib, content, shared or public/developer").toBe(true);
  });

  it("refuses a quote nobody published", () => {
    expect(isLive("TAVONEL compiles every format with perfect fidelity.")).toBe(false);
  });
});

/* ------------------------------------------------------------------------ forbidden words */

const FORBIDDEN: Record<GuideLanguage, readonly RegExp[]> = {
  en: [/\bverified\b/i, /\baccura(?:cy|te|tely)\b/i],
  ko: [/검증된/, /검증됨/, /검증 완료/, /정확도/, /\bverified\b/i, /\baccura(?:cy|te|tely)\b/i],
};
const forbiddenIn = (language: GuideLanguage, text: string) =>
  FORBIDDEN[language].filter((pattern) => pattern.test(withoutQuotes(text))).map(String);

describe("the guide never calls a page verified, and never calls completion accuracy", () => {
  it.each(LANGUAGES)("%s", (language) => {
    expect(forbiddenIn(language, guideText(language).join("\n"))).toEqual([]);
  });

  it("finds the words when they are there, and leaves a live quote alone", () => {
    expect(forbiddenIn("en", "Every page is verified.")).toHaveLength(1);
    expect(forbiddenIn("en", "Completion accuracy is high.")).toHaveLength(1);
    expect(forbiddenIn("ko", "검증된 결과입니다.")).toHaveLength(1);
    expect(forbiddenIn("en", "“This is a quotation selected by retrieval, not an independently verified conclusion.”")).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------ numbers */

/*
  The guide's numbers, each with where it comes from (the P2-22 inventory's method: a token is a
  whitespace-free run containing a digit, or an English number word). Numbers inside a live quote
  are bound by the quote check above and are not listed here.
*/
const NUMBER_ALLOWLIST: Record<string, string> = {
  "0": "the appendix's own chapter range, 'chapters 0 to 13' (this guide's chapter count)",
  "13": "the appendix's own chapter range, 'chapters 0 to 13' (this guide's chapter count)",
  "0-1000": "the region frame, /docs/cli and /docs/integration-recipes ('the 0-1000 coordinate frame')",
  "10-K": "a form name: EXPLORE_COPY.changeHint, lib/explore-story.ts ('Apple's 2025 Form 10-K')",
  "2025": "EXPLORE_COPY.changeHint, lib/explore-story.ts ('Apple's 2025 Form 10-K')",
  "2026": "EXPLORE_COPY.changeHint and the change act's own label, lib/explore-story.ts / change-act.tsx ('the 2026 filings arrived')",
  "2026-10-19": "GUIDE_REVIEWED, this guide's review date",
  "sha256": "an algorithm name, /developer/channel.json and /docs/concepts",
  "SHA256": "an algorithm name, the certutil argument",
  "256": "an algorithm name, the shasum argument (-a 256)",
  "sha256sum": "a command name",
  "Ed25519": "an algorithm name, /demo's Signed export step (components/signed-product-demo.tsx)",
  "v1": "a route segment, /api/v1/capabilities",
  "nine": "MCP_TOOL_COUNT_WORD, lib/mcp-tools.ts (the tool count, imported)",
  [String(9)]: "MCP_TOOLS.length, lib/mcp-tools.ts (the tool count, imported)",
  "two-arm": "/benchmarks/gdp-pdf's own description ('A two-arm run on the public GDP.pdf task set')",
  "2": "a name: Recipe 2 on /docs/integration-recipes, and SOC 2 in the Korean translation of the /trust certification row (content/trust/provisions.ts)",
  "27001": "ISO 27001, in the Korean translation of the /trust certification row (content/trust/provisions.ts)",
  "1": "SUPPORT_ACKNOWLEDGEMENT, lib/support-targets.ts ('within 1 business day (KST)')",
};

const NUMBER_WORDS = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|hundred|thousand|million)\b(?:-[a-z]+)?/gi;
const DIGIT_TOKENS = /[A-Za-z]*\d[\dA-Za-z.,:-]*/g;

function numbersIn(text: string): string[] {
  const prose = withoutQuotes(text)
    // A route path or an address is an identifier, not a number: /api/v1/capabilities.
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\btvnl_live_\S*/g, " ");
  return [...(prose.match(DIGIT_TOKENS) ?? []), ...(prose.match(NUMBER_WORDS) ?? []).map((word) => word.toLowerCase())]
    .map((token) => token.replace(/[.,:-]+$/, ""));
}

describe("every number outside a quote is on the allow-list", () => {
  it.each(LANGUAGES)("%s", (language) => {
    const unlisted = [...new Set(guideText(language).flatMap(numbersIn))].filter((token) => !(token in NUMBER_ALLOWLIST));
    expect(unlisted, "a number with no named source").toEqual([]);
  });

  it("catches a new number, and lets a quoted one through", () => {
    expect(numbersIn("It compiles 42 pages.").filter((token) => !(token in NUMBER_ALLOWLIST))).toEqual(["42"]);
    expect(numbersIn("It has three steps.").filter((token) => !(token in NUMBER_ALLOWLIST))).toEqual(["three"]);
    expect(numbersIn("“No SOC 2 report, ISO 27001 certificate or independent penetration-test report exists yet.”")).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------- media */

describe("the recordings", () => {
  it("names each of the three once per language", () => {
    for (const language of LANGUAGES) {
      const named = GUIDE[language].flatMap((chapter) => chapter.blocks.flatMap((block) => (block.kind === "media" ? [block.video] : [])));
      expect([...named].sort()).toEqual([...GUIDE_VIDEOS].sort());
    }
  });

  /* The file names enablement/VIDEO-MANIFEST.json lists (lane EN-2-3, 2026-10-19). */
  it("derives the manifest's file names", () => {
    expect(GUIDE_VIDEOS.flatMap((video) => GUIDE_VIDEO_VARIANTS.flatMap((variant) => Object.values(guideVideoFiles(video, variant)))).sort()).toEqual(
      ["guide-1-explore", "guide-2-mcp", "guide-3-api"]
        .flatMap((video) => ["desktop", "phone"].flatMap((variant) => ["mp4", "jpg", "en.vtt", "ko.vtt"].map((ext) => `${video}-${variant}.${ext}`)))
        .sort(),
    );
  });

  /*
    Half a delivery would render as no player at all while looking delivered in the tree. The
    files are committed now (MOUNT), so none missing is the only passing state: a player that
    vanished from /guide and the docs pages because its files went would otherwise stay green.
  */
  it("is delivered whole", () => {
    const root = join(nextjs, "public", "guide");
    for (const video of GUIDE_VIDEOS) {
      const files = GUIDE_VIDEO_VARIANTS.flatMap((variant) => Object.values(guideVideoFiles(video, variant)));
      const missing = files.filter((file) => !existsSync(join(root, file)));
      expect(missing, `${video}: missing from public/guide`).toEqual([]);
    }
  });

  /*
    public/guide/manifest.json pins every served file by sha256 (ENABLEMENT-GAP §4b "완료 기준"),
    copied from the video lane's VIDEO-MANIFEST.json with its local paths left out. A file whose
    bytes moved, a file the manifest does not list, and a listed file that is gone each fail.
  */
  function manifestFailures(root: string): string[] {
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { files: { file: string; bytes: number; sha256: string }[] };
    const listed = new Set(manifest.files.map((entry) => entry.file));
    const failures = readdirSync(root).filter((file) => file !== "manifest.json" && !listed.has(file)).map((file) => `${file}: not in the manifest`);
    for (const { file, bytes, sha256 } of manifest.files) {
      if (!existsSync(join(root, file))) { failures.push(`${file}: listed, not present`); continue; }
      const body = readFileSync(join(root, file));
      const digest = createHash("sha256").update(body).digest("hex");
      if (digest !== sha256 || body.length !== bytes) failures.push(`${file}: ${body.length} B sha256 ${digest}, manifest ${bytes} B ${sha256}`);
    }
    return failures;
  }

  it("matches its manifest byte for byte, and the manifest names every file the player loads", () => {
    const root = join(nextjs, "public", "guide");
    expect(manifestFailures(root)).toEqual([]);
    const listed = (JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { files: { file: string }[] }).files.map((entry) => entry.file).sort();
    expect(listed).toEqual(GUIDE_VIDEOS.flatMap((video) => GUIDE_VIDEO_VARIANTS.flatMap((variant) => Object.values(guideVideoFiles(video, variant)))).sort());
    expect(readFileSync(join(root, "manifest.json"), "utf8")).not.toMatch(/\b[A-Z]:[\\/]|\/Users\/|yspow/);
  });

  it("fails on a changed byte, an unlisted file and a missing one", () => {
    const root = mkdtempSync(join(tmpdir(), "guide-manifest-"));
    try {
      const sha256 = createHash("sha256").update("abc").digest("hex");
      writeFileSync(join(root, "manifest.json"), JSON.stringify({ files: [{ file: "a.vtt", bytes: 3, sha256 }, { file: "b.vtt", bytes: 3, sha256 }] }));
      writeFileSync(join(root, "a.vtt"), "abd");
      writeFileSync(join(root, "c.vtt"), "abc");
      expect(manifestFailures(root)).toEqual([
        "c.vtt: not in the manifest",
        `a.vtt: 3 B sha256 ${createHash("sha256").update("abd").digest("hex")}, manifest 3 B ${sha256}`,
        "b.vtt: listed, not present",
      ]);
      writeFileSync(join(root, "a.vtt"), "abc");
      rmSync(join(root, "c.vtt"));
      writeFileSync(join(root, "b.vtt"), "abc");
      expect(manifestFailures(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  const vtt = "WEBVTT\r\n\r\nNOTE recorded 2026-10-19\r\n\r\n1\r\n00:00.000 --> 00:04.000\r\nFirst line\r\nwraps here.\r\n\r\n2\r\n00:04.000 --> 00:09.500\r\n<v Guide>Second cue.</v>\r\n";

  it("reads a transcript out of the caption file", () => {
    expect(vttCueText(vtt)).toEqual(["First line wraps here.", "Second cue."]);
    expect(vttCueText("WEBVTT\n")).toEqual([]);
  });

  it("refuses to render a player with a file missing, and never renders one that moves by itself", () => {
    const root = mkdtempSync(join(tmpdir(), "guide-media-"));
    try {
      const block = { kind: "media", video: "guide-2-mcp", title: "A recording" } as const;
      expect(guideVideoReady("guide-2-mcp", root)).toBe(false);
      expect(() => renderToStaticMarkup(createElement(GuideMedia, { block, language: "en", root })))
        .toThrow(/guide-2-mcp is missing guide-2-mcp-desktop\.mp4, .*guide-2-mcp-phone\.ko\.vtt from public\/guide/);
      for (const variant of GUIDE_VIDEO_VARIANTS) {
        for (const file of Object.values(guideVideoFiles("guide-2-mcp", variant))) writeFileSync(join(root, file), vtt);
      }
      expect(guideVideoReady("guide-2-mcp", root)).toBe(true);
      for (const language of LANGUAGES) {
        const html = renderToStaticMarkup(createElement(GuideMedia, { block, language, root }));
        const videos = html.match(/<video [^>]*>/g) ?? [];
        expect(videos).toHaveLength(2);
        for (const tag of videos) {
          expect(tag).toContain("controls");
          expect(tag).toContain('preload="none"');
          expect(tag).not.toMatch(/autoplay|\bloop\b|\bmuted\b/i);
          expect(tag).toMatch(/ poster="[/]guide[/]guide-2-mcp-(desktop|phone)[.]jpg"/);
        }
        expect(html).toContain('<track kind="captions" src="/guide/guide-2-mcp-desktop.en.vtt" srcLang="en" label="English"');
        expect(html).toContain('src="/guide/guide-2-mcp-phone.ko.vtt" srcLang="ko" label="한국어"');
        expect(html.match(/<track [^>]*default=""/g)).toHaveLength(2);
        expect(html).toMatch(new RegExp(`srcLang="${language}"[^>]*default=""`));
        expect(html).toContain(`<summary>${GUIDE_UI[language].transcript}</summary>`);
        expect(html).toContain("<li>First line wraps here.</li>");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/* -------------------------------------------------------------------------------- pages */

describe("the two pages", () => {
  const en = renderToStaticMarkup(createElement(EnglishGuide));
  const ko = renderToStaticMarkup(createElement(KoreanGuide));

  it("render every chapter as an anchored section, in their own language", () => {
    for (const [html, language] of [[en, "en"], [ko, "ko"]] as const) {
      for (const chapter of GUIDE[language]) {
        expect(html).toContain(`<section id="${chapter.id}"`);
        expect(html).toContain(`href="#${chapter.id}"`);
      }
    }
    // UX-L7 (P2-11): every public root declares its template; the guide reads as T3 Reference, like /docs.
    expect(ko).toContain('<div class="page public-page" lang="ko" data-template="T3">');
    expect(en).toContain('<div class="page public-page" data-template="T3">');
  });

  it("send a Korean reader to the Korean page where one exists, and say when a link is English", () => {
    expect(ko).toContain('href="/ko/contact"');
    expect(ko).not.toMatch(/href="\/contact"[^>]*>이용 문의/);
    expect(ko).toMatch(/hrefLang="en"[^>]*>Compiled World 살펴보기 \(영문\)/);
    expect(ko).toMatch(/href="\/developer\/channel\.json"[^>]*>channel\.json</);
  });

  /*
    Script budget (§22): a Link in the first viewport prefetches its route's chunks. The /docs hub
    tile did, and it added 3,065 transferred script bytes to /docs; the guide's own links are below
    the fold, but are not prefetched either.
  */
  it("are linked without prefetch, from the docs hub and from their own chapters", () => {
    expect(readFileSync(join(nextjs, "app", "docs", "page.tsx"), "utf8")).toContain('<Link href={"/guide" as Route} prefetch={false}>');
    expect(readFileSync(join(nextjs, "components", "guide", "guide-page.tsx"), "utf8")).toMatch(/<Link [^>]*prefetch={false}/);
  });

  // The nav entries the guide adds fit under the ratchet only because NAV_GROUPS, which nothing
  // renders, no longer keeps RESOURCE_LINKS in every page's client bundle (lib/site-navigation.ts).
  it("leave RESOURCE_LINKS out of the client bundle", () => {
    const source = readFileSync(join(nextjs, "lib", "site-navigation.ts"), "utf8");
    expect(source.split("/*#__PURE__*/ resourceColumn(").length - 1).toBe(source.split("resourceColumn(\"").length - 1);
  });

  it("end on the feedback address and the review date", () => {
    expect(en).toContain("mailto:support@tavonel.com?subject=Guide%20feedback%3A%20Product%20guide");
    expect(en).toContain("Reviewed 19 October 2026");
    expect(ko).toContain("검토일 2026년 10월 19일");
  });
});

/* ------------------------------------------------------------------------ docs pages */

/*
  MOUNT (ENABLEMENT-GAP §4b): the API recording under the quickstart's try-it and on /api, the
  MCP recording on /docs/mcp, each the guide's own player, files and title. Every other docs
  section carries none.
*/
describe("the recordings on the docs pages", () => {
  const section = async (slug: string) => renderToStaticMarkup(await DocsSectionPage({ params: Promise.resolve({ section: slug }) }));
  const recordings = (html: string) => [...html.matchAll(/data-guide-video="([a-z0-9-]+)"/g)].map((match) => match[1]);

  it("show the API recording on the quickstart, below the try-it and above the intake note", async () => {
    const html = await section("quickstart");
    expect(recordings(html)).toEqual(["guide-3-api"]);
    const at = html.indexOf("data-guide-video");
    expect(html.indexOf("data-keyless-try-it")).toBeLessThan(at);
    expect(at).toBeLessThan(html.indexOf("Before you start."));
    expect(html).toContain('src="/guide/guide-3-api-desktop.mp4"');
    expect(html).toContain(`<figcaption id="guide-3-api-title">${guideMediaBlock("guide-3-api").title}</figcaption>`);
  });

  it("show the MCP recording on /docs/mcp and the API recording on /api", async () => {
    expect(recordings(await section("mcp"))).toEqual(["guide-2-mcp"]);
    expect(recordings(renderToStaticMarkup(await ApiReferencePage()))).toEqual(["guide-3-api"]);
    // A page cannot name a recording the guide does not carry: the lookup throws rather than render an untitled player.
    expect(() => guideMediaBlock("guide-4-upload" as never)).toThrow("the en guide has no media block for guide-4-upload");
  });

  it("leave every other section without one", async () => {
    for (const { slug } of DOCS_SECTIONS.filter((entry) => !["quickstart", "mcp"].includes(entry.slug))) {
      expect(recordings(await section(slug)), slug).toEqual([]);
    }
  });
});
