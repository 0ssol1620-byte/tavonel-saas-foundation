import Link from "next/link";
import type { Route } from "next";
import {
  PublicSiteFooter,
  PublicSiteHeader,
} from "@/components/public-site-chrome";
import HeroFilm from "./hero-film";
import HeroActions from "./hero-actions";
import HeroSourceCard from "./hero-source-card";
import HeroStatement from "./hero-statement";
import heroStyles from "./landing-hero.module.css";
import LandingAnalytics from "./landing-analytics";
import RecompileScene from "./scenes/recompile";
import StartScene from "./scenes/start";
import TrustScene from "./scenes/trust";
import { KO_EXPLORE_LABEL } from "./scene-actions";
import { landingV2Copy } from "@/lib/landing-v2-copy";
import { landingV2HeroExtra } from "@/lib/landing-v2-hero-copy";
import {
  buildEvidenceRecord,
  buildHeroView,
  buildProofTabs,
  buildRecompileView,
  landingV2StateWord,
  SOURCES_COPY,
  type EvidenceRecord,
  type RecompileView,
} from "@/lib/landing-v2-runtime";
import {
  buildHomeEvidenceCase,
  caseStatus,
  displayableRegions,
  HOME_RESERVED_CASE,
  selectHomeCase,
  type EvidenceCase,
  type EvidenceRegion,
} from "@/lib/home-evidence-view";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import { KO_CHROME } from "@/lib/site-navigation";
import { primaryCallToAction } from "@/lib/commercial-state";
import {
  landingVariantState,
  type LandingVariantState,
} from "@/lib/landing-experiments";

/*
  Home, structural candidate 2026-10-08. One composition, two languages.

  Six beats: a short lead over one full-width workbench (source -> highlighted passage -> record),
  why that passage is difficult, what a reader receives, what changed in the sources, method and
  trust, and the close. Scene ids `s1`-`s6` and their focusable landmarks are unchanged.

  WHAT LEFT THE PAGE, AND WHY
  The compiler specimen printed a period, unit and value typed by hand beside the operating-expense
  passage -- a solved answer nothing on the page had checked -- and the proof tabs framed the same
  passage as the answer to an R&D question. Both are gone from Home. The passage stays, labelled
  for what it is: an existing extracted passage, with the context it lacks pointed at rather than
  filled in.

  WHY THIS IS A SERVER COMPONENT
  The public World is a committed snapshot. This file reads it once and hands each beat a flat,
  serializable projection; the workbench's region selection, the action row and the optional
  film are the only client islands.
*/

/*
  The immutable snapshot projections are shared across `/` and `/ko` renders. Both routes stay
  `force-dynamic` so their commercial posture is resolved for each request.
*/
type HomeData = {
  home: EvidenceCase | null;
  record: EvidenceRecord;
  recompile: RecompileView;
  /** How many extracted regions the workbench's page holds, read from the page view. */
  pageRegionCount: number;
};
let homeMemo: HomeData | undefined;
function homeData(): HomeData {
  return (homeMemo ??= {
    home: selectHomeCase([buildHomeEvidenceCase(buildHeroView(), buildProofTabs()), HOME_RESERVED_CASE]),
    record: buildEvidenceRecord(),
    recompile: buildRecompileView(),
    pageRegionCount: buildHeroView().regions.length,
  });
}

/*
  The words only this composition says, in both languages. No figure in any of them: every digit
  on Home is read from the World and printed inside a `data-derived` element.
*/
const HOME_COPY = {
  en: {
    support: "Explore versioned knowledge and inspect the passages behind it.",
    intake: "Own-source intake by arrangement",
    difficulty: {
      eyebrow: "Why this passage is hard",
      title: "A value is printed in one place. What it counts is printed in another.",
      support:
        "Reading this page correctly takes more than extracting one region. These difficulties are visible in the page itself; this preview shows them and does not claim to have resolved them.",
      items: {
        values: {
          title: "Values without headings",
          body: "The selected passage lists two values for each line item, with no column heading or unit beside them.",
        },
        conditions: {
          title: "Conditions printed elsewhere",
          body: "The statement heading and the column headings sit in separate regions above the passage, on the same page.",
        },
        neighbours: {
          title: "Similar passages nearby",
          before: "This one page holds",
          after: "extracted regions, several of them rows of paired values.",
        },
      },
      open: (mark: string) => `Open region ${mark}`,
      reserved:
        "A harder multi-page case is reserved for this place. It has not been processed, qualified or rights-cleared, so nothing from it is shown.",
    },
    receive: {
      eyebrow: "What you receive",
      title: "Versioned knowledge, with every passage still attached.",
      support:
        "Each object in a Compiled World is a record: the source's own words, the version they were read from, and the region you can open.",
      kind: (kind: string) => kind,
      notes: [
        { title: "Versioned", body: "Bound to the digest of the exact source version it was read from." },
        { title: "Source-bound", body: "The text is the source's own wording, not a rewrite of it." },
        { title: "Inspectable", body: "Page and region coordinates open the place it came from." },
      ],
      openRegion: "Open this region in Explore",
      methodTitle: "Three separate steps",
      method: [
        { title: "Extraction", body: "Reads a region's text and binds it to its page. The passages on this page are extracted." },
        { title: "Interpretation", body: "Joins a value to its period, unit or version. Not run for this preview." },
        {
          title: "Verification",
          body: "Needs every material claim cited to complete regions, with its conditions, from a qualified run. Nothing here is presented as verified.",
        },
      ],
      rights:
        "The sources shown are public filings already published in this site's sample. Other sources need rights clearance before they appear here.",
    },
  },
  ko: {
    support: "버전이 관리되는 지식을 살펴보고, 그 뒤의 원문 구절을 직접 확인하세요.",
    intake: "자체 원문 접수는 별도 협의",
    difficulty: {
      eyebrow: "이 구절이 어려운 이유",
      title: "값은 한곳에, 그 값이 무엇인지는 다른 곳에 인쇄되어 있습니다.",
      support:
        "이 페이지를 올바르게 읽으려면 영역 하나를 추출하는 것으로는 부족합니다. 아래 어려움은 페이지 자체에서 보이며, 이 미리보기는 이를 보여 줄 뿐 해결했다고 주장하지 않습니다.",
      items: {
        values: {
          title: "제목 없는 값",
          body: "선택한 구절은 항목마다 값 두 개를 나열하지만, 그 옆에 열 제목이나 단위가 없습니다.",
        },
        conditions: {
          title: "다른 곳에 인쇄된 조건",
          body: "재무제표 제목과 열 제목은 같은 페이지에서 이 구절 위의 별도 영역에 있습니다.",
        },
        neighbours: {
          title: "가까이 있는 비슷한 구절",
          before: "이 한 페이지에 추출된 영역이",
          after: "개 있고, 그중 여럿이 값 두 개가 짝을 이룬 행입니다.",
        },
      },
      open: (mark: string) => `영역 ${mark} 열기`,
      reserved:
        "여러 페이지에 걸친 더 어려운 사례를 이 자리에 예약해 두었습니다. 아직 처리, 적격 판정, 권리 허가를 거치지 않았으므로 그 내용은 보여 주지 않습니다.",
    },
    receive: {
      eyebrow: "받게 되는 것",
      title: "모든 구절이 계속 붙어 있는, 버전이 관리되는 지식.",
      support:
        "Compiled World의 각 객체는 기록입니다. 원문의 문장 그대로, 그것을 읽어 온 버전, 그리고 열어 볼 수 있는 영역을 함께 가집니다.",
      kind: (kind: string) => (kind === "Claim" ? "진술" : kind),
      notes: [
        { title: "버전 관리", body: "읽어 온 원문 버전의 다이제스트에 묶여 있습니다." },
        { title: "원문에 묶임", body: "문장은 원문 그대로이며, 다시 쓴 것이 아닙니다." },
        { title: "확인 가능", body: "페이지와 영역 좌표로 그것이 나온 위치를 열 수 있습니다." },
      ],
      openRegion: "Explore에서 이 영역 열기",
      methodTitle: "서로 다른 세 단계",
      method: [
        { title: "추출", body: "영역의 텍스트를 읽고 그 페이지에 묶습니다. 이 페이지의 구절은 추출된 것입니다." },
        { title: "해석", body: "값을 기간, 단위, 버전과 묶습니다. 이 미리보기에서는 실행하지 않았습니다." },
        {
          title: "검증",
          body: "모든 핵심 진술이 조건과 함께 완전한 영역에 인용되고, 적격 판정을 받은 실행에서 나와야 합니다. 여기의 어떤 것도 검증된 것으로 제시하지 않습니다.",
        },
      ],
      rights:
        "보여 주는 원문은 이 사이트의 샘플에 이미 게시된 공개 공시 문서입니다. 다른 원문은 권리 허가를 거친 뒤에만 여기에 표시됩니다.",
    },
  },
};

/** The workbench's letter for a region: its position among the displayable regions, as printed there. */
const regionMark = (home: EvidenceCase, region: EvidenceRegion) =>
  String.fromCharCode(65 + displayableRegions(home).indexOf(region));

export default function LandingPage({
  korean = false,
  /*
    D8: the running experiment and this reader's arm, resolved on the server by `app/page.tsx`
    and `app/ko/page.tsx` from the request's cookie and `?lp=`.

    The default is the whole of "experiments are off": no test, arm "a" in both places, and no
    `variant` property on any event -- which is what this page renders on every deployment
    today, and what `lib/landing-v2-page.test.ts` renders when it calls this component with no
    props at all.
  */
  experiment = landingVariantState({ experiment: null }),
  children,
}: {
  korean?: boolean;
  experiment?: LandingVariantState;
  /** `/ko`'s document-language effect and breadcrumb. Rendered inside the landmark, as today. */
  children?: React.ReactNode;
}) {
  const copy = landingV2Copy(korean);
  const data = homeData();
  const locale = korean ? "ko" : "en";
  const page = HOME_COPY[locale];
  const { home, record } = data;
  const byRole = (role: EvidenceRegion["role"]) =>
    home ? displayableRegions(home).find(region => region.role === role) : undefined;
  const selected = byRole("selected");
  const conditionRegions = [byRole("statement-heading"), byRole("column-headings")].filter(
    (region): region is EvidenceRegion => region !== undefined,
  );
  const regionLink = (region: EvidenceRegion) =>
    home && region.href ? (
      <Link key={region.id} className={heroStyles.diffLink} href={region.href as Route} prefetch={false}>
        {page.difficulty.open(regionMark(home, region))}
        <span aria-hidden="true">↗</span>
      </Link>
    ) : null;
  const formats = korean ? copy.hero.microProofFormats.replace(" or ", " 또는 ") : copy.hero.microProofFormats;

  /*
    A reader can inspect the sample before choosing a plan. The access action is resolved from
    the current commercial state rather than written here. While that state resolves to
    `/contact`, the hero's access action is the document evaluation instead; the close keeps its
    own separately authored CTA copy and the resolved access link in `./scenes/start`.
  */
  const heroActions = {
    exploreLabel: korean ? KO_EXPLORE_LABEL : EXPLORE_CTA.label,
    exploreHref: EXPLORE_CTA.href,
  };
  const access = primaryCallToAction();
  const startActions = {
    ...heroActions,
    accessHref: korean && access.href === "/contact" ? "/ko/contact" : access.href,
    accessLabel: korean ? KO_CHROME.cta[access.href] : access.label,
  };
  const heroStart = {
    label: access.href === "/contact" ? (korean ? "내 문서 평가 상담" : "Evaluate your documents") : startActions.accessLabel,
    href: access.href === "/contact" ? (korean ? "/ko/evaluation" : "/evaluation") : startActions.accessHref,
  };

  return (
    <div className={`page lv2 ${heroStyles.home}`} lang={korean ? "ko" : undefined}>
      <PublicSiteHeader korean={korean} />
      <main id="main" tabIndex={-1} data-home-ia="outcome-v1.1">
        {children}
        {/*
          D7: the landing's whole funnel, in one mounted listener that renders nothing (§30).
          It is inside `main` because that is what it listens to -- the site chrome above and
          below is every page's, not this page's. `variant` is undefined while no test runs, and
          no event then carries the property at all.
        */}
        <LandingAnalytics variant={experiment.tracked} />

        {/*
          01 Lead and workbench. A short statement with one filled action and the quieter
          commercial one, then the workbench at the full content width: the source page, the
          highlighted passage, and the record it belongs to.
        */}
        <section
          id="s1"
          data-scene="1"
          tabIndex={-1}
          aria-labelledby="lv2-hero-title"
          className={`lv2-scene lv2-hero ${heroStyles.hero}`}
        >
          <div className={`lv2-wrap ${heroStyles.layout}`}>
            <div className={heroStyles.intro}>
              {/* The founder headline in the page's own sans; no serif accent. */}
              <HeroStatement
                copy={{ ...copy.hero, support: page.support }}
                titleId="lv2-hero-title"
                headlineVariant={experiment.headlineVariant}
              />
              <div className={heroStyles.actionsBlock}>
                <HeroActions
                  exploreLabel={heroActions.exploreLabel}
                  exploreHref={heroActions.exploreHref}
                  startLabel={heroStart.label}
                  startHref={heroStart.href}
                  scene="1"
                  ctaOrderVariant={experiment.ctaOrderVariant}
                />
                <p className={heroStyles.intakeNote}>{page.intake}</p>
              </div>
            </div>
            {home ? <HeroSourceCard view={home} korean={korean} /> : null}
            <p className={`lv2-hero-intake lv2-meta ${heroStyles.intake}`}>
              {SOURCES_COPY[locale].formatsLabel} · {formats}
            </p>
          </div>
        </section>

        {/*
          02 Why this case is difficult. Every difficulty points at a region the workbench above
          already shows; none of them is claimed as solved.
        */}
        <section
          id="s2"
          data-scene="2"
          tabIndex={-1}
          aria-labelledby="lv2-difficulty-title"
          className={`lv2-scene lv2-paper ${heroStyles.difficulty}`}
        >
          <div className={`lv2-wrap ${heroStyles.split}`}>
            <div className={heroStyles.splitHead}>
              <p className="lv2-eyebrow lv2-meta">{page.difficulty.eyebrow}</p>
              <h2 className="lv2-h2" id="lv2-difficulty-title">{page.difficulty.title}</h2>
              <p className="lv2-scene-support">{page.difficulty.support}</p>
            </div>
            {home && selected ? (
              <ol className={heroStyles.diffList}>
                <li>
                  <h3>{page.difficulty.items.values.title}</h3>
                  <p>{page.difficulty.items.values.body}</p>
                  <p className={heroStyles.diffLinks}>{regionLink(selected)}</p>
                </li>
                {conditionRegions.length > 0 ? (
                  <li>
                    <h3>{page.difficulty.items.conditions.title}</h3>
                    <p>{page.difficulty.items.conditions.body}</p>
                    <p className={heroStyles.diffLinks}>{conditionRegions.map(regionLink)}</p>
                  </li>
                ) : null}
                <li>
                  <h3>{page.difficulty.items.neighbours.title}</h3>
                  <p>
                    {page.difficulty.items.neighbours.before}{" "}
                    <b data-derived="1">{data.pageRegionCount}</b>
                    {korean ? "" : " "}
                    {page.difficulty.items.neighbours.after}
                  </p>
                </li>
              </ol>
            ) : null}
            {caseStatus(HOME_RESERVED_CASE) === "prepared" ? (
              <p className={heroStyles.reserved}>{page.difficulty.reserved}</p>
            ) : null}
            {/*
              The optional, illustrative walkthrough: closed on load, its player mounted only once
              opened. It stays in `#s2` because `LandingAnalytics` counts `hero_demo_interact` there.
            */}
            <div className={heroStyles.filmSlot}>
              <HeroFilm korean={korean} />
            </div>
          </div>
        </section>

        {/*
          03 What you receive: one record of the published sample World, as large as a page, with
          the three things that make it knowledge rather than text beside it. Its status is the
          World's own word; nothing here is presented as verified.
        */}
        <section
          id="s3"
          data-scene="3"
          tabIndex={-1}
          aria-labelledby="lv2-receive-title"
          className={`lv2-scene lv2-paper ${heroStyles.receive}`}
        >
          <div className="lv2-wrap">
            <div className={heroStyles.receiveHead}>
              <p className="lv2-eyebrow lv2-meta">{page.receive.eyebrow}</p>
              <h2 className="lv2-h2" id="lv2-receive-title">{page.receive.title}</h2>
              <p className="lv2-scene-support">{page.receive.support}</p>
            </div>
            <div className={heroStyles.receiveGrid}>
              <article className={heroStyles.recordSheet} aria-labelledby="lv2-record-kind">
                <p className={heroStyles.recordKind} id="lv2-record-kind">
                  <span>{page.receive.kind(record.claim.kind)}</span>
                  <span className={heroStyles.recordState}>{landingV2StateWord(record.status.state, locale)}</span>
                </p>
                <blockquote className={heroStyles.recordQuote} lang="en" data-derived="1">
                  {record.claim.excerpt}{record.claim.excerptTruncated ? "…" : ""}
                </blockquote>
                <dl className={heroStyles.recordFields}>
                  <div>
                    <dt>{copy.evidence.fields.source}</dt>
                    <dd data-derived="1">{record.source.filename} · {record.source.form} · {record.source.filingDate}</dd>
                  </div>
                  <div>
                    <dt>{copy.evidence.fields.page}</dt>
                    <dd data-derived="1">
                      {korean
                        ? `${record.source.pageCount}쪽 중 ${record.source.page}쪽`
                        : `page ${record.source.page} of ${record.source.pageCount}`}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.evidence.fields.region}</dt>
                    <dd>
                      <span data-derived="1">bbox {record.region.bbox1000.join(",")}</span> · {copy.evidence.regionUnit}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.evidence.fields.version}</dt>
                    <dd><code data-derived="1">{record.version.digest}</code></dd>
                  </div>
                </dl>
                <p className={heroStyles.recordLinks}>
                  <Link className={heroStyles.diffLink} href={record.hrefs.evidence as Route} prefetch={false} data-analytics="source-open">
                    {page.receive.openRegion}
                    <span aria-hidden="true">↗</span>
                  </Link>
                  <a className={heroStyles.diffLink} href={record.hrefs.original}>
                    {copy.evidence.openOriginal}
                    <span aria-hidden="true">↗</span>
                  </a>
                </p>
              </article>

              <div className={heroStyles.receiveNotes}>
                <ul className={heroStyles.noteList}>
                  {page.receive.notes.map(note => (
                    <li key={note.title}>
                      <h3>{note.title}</h3>
                      <p>{note.body}</p>
                    </li>
                  ))}
                </ul>
                <div className={heroStyles.method}>
                  <h3>{page.receive.methodTitle}</h3>
                  <ol>
                    {page.receive.method.map(step => (
                      <li key={step.title}>
                        <b>{step.title}</b> {step.body}
                      </li>
                    ))}
                  </ol>
                </div>
                <p className={heroStyles.rights}>{page.receive.rights}</p>
              </div>
            </div>
            <p className="lv2-scene-note lv2-small">{landingV2HeroExtra(korean).entityDisclaimer}</p>
          </div>
        </section>

        <RecompileScene
          locale={locale}
          copy={copy.recompile}
          data={data.recompile}
          sectionId="s4"
          sceneIndex={4}
        />
        <TrustScene locale={locale} copy={copy.trust} sectionId="s5" sceneIndex={5} />
        <StartScene locale={locale} copy={copy.start} actions={startActions} sectionId="s6" sceneIndex={6} />
      </main>
      <PublicSiteFooter korean={korean} />
    </div>
  );
}
