/*
  First, on purpose: import order is stylesheet order, and the player's stylesheet leading the
  guide's list is one of the two facts that keep Next's CSS chunking where main has it (the other
  is where components/api-try-it.tsx lives; see there). Measured on PR #159: without them /explore,
  which uses neither, loaded nine stylesheets instead of seven and its Lighthouse LCP went from
  about 2,750 ms to 3,095 ms, over the 3,000 ms budget.
*/
import { GuideMedia } from "./guide-media";
import Link from "next/link";
import type { Route } from "next";
import DocumentLangKo from "@/app/ko/document-lang";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import { CodeTokens } from "@/components/docs/code-tokens";
import { withMarks } from "@/components/docs/marks";
import layout from "@/components/docs/docs-toc.module.css";
import { PublicSitePage } from "@/components/public-site-chrome";
import { formatReviewDate } from "@/lib/docs-content";
import {
  GUIDE,
  GUIDE_REVIEWED,
  GUIDE_UI,
  type GuideBlock,
  type GuideChapter,
  type GuideLanguage,
} from "@/lib/guide-content";
import styles from "./guide.module.css";

/*
  /guide and /ko/guide (EN-1). The docs reading surface -- the same `.docs-reading-surface`
  scene, the same chapter rail and article columns from `docs-toc.module.css`, the same block
  classes `app/docs/[section]/page.tsx` renders -- with the guide's chapters in place of a docs
  section. One page per language with a fragment per chapter, not fourteen routes.

  No client component of its own. The rail is the docs rail's two-copies pattern (a `<nav>` that
  CSS shows from 1080px, a closed `<details>` below it), and the recordings are native `<video>`.
  The one client module is `DocumentLangKo`, which every /ko page already mounts.
*/

/* -------------------------------------------------------------------------------- blocks */

/* The docs renderer's markup for the kinds the guide uses (`app/docs/[section]/page.tsx`). */
function Block({ block, language }: { block: GuideBlock; language: GuideLanguage }) {
  switch (block.kind) {
    case "prose":
      return <p>{withMarks(block.text)}</p>;
    case "note":
      return <p className="docs-note"><strong>{language === "ko" ? "참고" : "Note"}</strong> {withMarks(block.text)}</p>;
    case "steps":
      return <ol className="docs-steps">{block.items.map((item) => <li key={item}>{withMarks(item)}</li>)}</ol>;
    case "code":
      return (
        <figure className="docs-code">
          <figcaption><span>{block.label}</span></figcaption>
          <pre tabIndex={0} role="group" aria-label={block.label}><code><CodeTokens body={block.body} /></code></pre>
        </figure>
      );
    case "table":
      return (
        <div className="table-scroll">
          <table className="docs-table">
            <thead><tr>{block.head.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, index) => <td key={index} data-label={block.head[index]}>{withMarks(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "media":
      return <GuideMedia block={block} language={language} />;
  }
}

/*
  A chapter link. On /ko/guide a link to a page that has no Korean version says so, the way the
  /ko pages already do ("공개 World 확인 (영문)", `hrefLang="en"`); a file or a mail address is not
  a page in a language, so it carries neither.
*/
function ChapterLink({ link, language }: { link: GuideChapter["links"][number]; language: GuideLanguage }) {
  if (link.href.startsWith("mailto:")) return <a href={link.href}>{link.label}</a>;
  const path = link.href.split(/[?#]/)[0]!;
  const isFile = /\.[a-z0-9]+$/i.test(path);
  const english = language === "ko" && !isFile && !(path === "/ko" || path.startsWith("/ko/"));
  return (
    <Link href={link.href as Route} hrefLang={english ? "en" : undefined} prefetch={false}>
      {link.label}{english ? GUIDE_UI.ko.englishOnly : ""}
    </Link>
  );
}

function reviewDate(language: GuideLanguage): string {
  if (language === "en") return formatReviewDate(GUIDE_REVIEWED);
  const [year, month, day] = GUIDE_REVIEWED.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

export function GuidePage({ language }: { language: GuideLanguage }) {
  const korean = language === "ko";
  const ui = GUIDE_UI[language];
  const chapters = GUIDE[language];
  const list = (
    <ul className={layout.list}>
      {chapters.map((chapter) => (
        <li key={chapter.id}>
          <a className={layout.link} href={`#${chapter.id}`}>{chapter.title}</a>
        </li>
      ))}
    </ul>
  );
  const trail = korean
    ? [{ name: "한국어 안내", path: "/ko" }, { name: ui.title, path: "/ko/guide" }]
    : [{ name: "Resources", path: "/resources" }, { name: ui.title, path: "/guide" }];

  return (
    <PublicSitePage korean={korean} languageHref={korean ? "/guide" : "/ko/guide"}>
      {korean ? <DocumentLangKo /> : null}
      <BreadcrumbJsonLd trail={trail} />
      <section className="scene doc docs-reading-surface" aria-labelledby="guide-title">
        <div className="shell"><div className={layout.layout}>
          <div className={layout.rail}>
            <nav className={layout.column} aria-label={ui.contents}>{list}</nav>
            <details className={layout.disclosure}>
              <summary>{ui.contents}</summary>
              <nav aria-label={ui.contents}>{list}</nav>
            </details>
          </div>
          <div className="body">
            <div className="stack">
              <h1 className="document-title" id="guide-title">{ui.title}</h1>
            </div>
            <div className={`stack docs-body ${layout.readingLayout}`}>
              <p className="lede">{ui.lede}</p>
              <div className={`stack ${layout.articleContent}`}>
                {chapters.map((chapter) => (
                  <section key={chapter.id} id={chapter.id} className={`stack ${styles.chapter}`} aria-labelledby={`${chapter.id}-heading`}>
                    <h2 id={`${chapter.id}-heading`}>{chapter.title}</h2>
                    {chapter.blocks.map((block, index) => <Block key={index} block={block} language={language} />)}
                    <p className={`fine ${styles.where}`}>
                      <span>{ui.where}</span>
                      {chapter.links.map((link) => <ChapterLink key={link.href} link={link} language={language} />)}
                    </p>
                  </section>
                ))}
              </div>
            </div>
            <p className="fine">{ui.reviewed} {reviewDate(language)}</p>
            <p className="fine">
              {ui.feedbackLead}{" "}
              <a href={`mailto:support@tavonel.com?subject=${encodeURIComponent(ui.feedbackSubject)}`}>{ui.feedbackLink}</a>
              {korean ? "" : "."}
            </p>
          </div>
        </div></div>
      </section>
    </PublicSitePage>
  );
}
