import { Fragment } from "react";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-site-chrome";
import HeroFilm from "./hero-film";
import HeroStill from "./hero-still";
import { PHONE_HERO } from "@/lib/hero-phone-mode";
import HeroActions from "./hero-actions";
import HeroSourceCard from "./hero-source-card";
import HeroStatement from "./hero-statement";
import HomeMeasures from "./home-measures";
import heroStyles from "./landing-hero.module.css";
import sourceStyles from "./source-first-home.module.css";
import LandingAnalytics from "./landing-analytics";
import SpecimenStrip from "./specimen-strip";

import RecompileScene from "./scenes/recompile";
import StartScene from "./scenes/start";
import TrustScene from "./scenes/trust";
import { landingV2Copy } from "@/lib/landing-v2-copy";
import { SELF_SERVE_CTA, START_FREE_LABEL } from "@/lib/site-navigation";
import {
  buildHeroView,
  buildProofTabs,
  buildReceiveRecord,
  buildRecompileView,
  type ReceiveRecord,
  type RecompileView,
} from "@/lib/landing-v2-runtime";
import {
  buildHomeEvidenceCase,
  displayableRegions,
  HOME_RESERVED_CASE,
  selectHomeCase,
  type EvidenceCase,
} from "@/lib/home-evidence-view";
import { KO_CHROME, SAMPLE_CTA } from "@/lib/site-navigation";
import { primaryCallToAction } from "@/lib/commercial-state";
import { homeSpecimens } from "@/lib/specimen-sources";
import {
  landingVariantState,
  type LandingVariantState,
} from "@/lib/landing-experiments";

/*
  Home, FINAL-SPEC 2026-10-26 ("product as hero"). One composition, two languages.

  Six beats, unchanged in id and ground: the statement and the compile film (s1), the receipted
  measures, one passage followed to its source (s2), the record a reader receives (s3), what changed
  when new filings arrived (s4), where TAVONEL draws the line (s5), and the close (s6). Each beat says
  at most one sentence of its own; the rest is the product's own data, its receipts and the fixed
  disclosures (the not-customer-results caption, the workbench status line, the rights sentence, the
  training-data sentence and the customer-data gate), which stay visible verbatim.

  WHAT LEFT THE PAGE (FINAL-SPEC §6), AND WHERE IT STILL LIVES
  The hero eyebrow is now s6's h2. The intake sentence and the FAQ are not mounted here; the FAQ keeps
  its F-grade answers in `home-reader-guide.tsx`, and s6 prints the customer-data gate and the sample
  boundary in their own words. The difficulty disclosure, the record's notes and the three-step method
  are gone; their facts stay on the workbench status line, in Source details and in the copy deck.

  WHY THIS IS A SERVER COMPONENT
  The public World is a committed snapshot. This file reads it once and hands each beat a flat,
  serializable projection; the workbench's region selection, the action row and the visible
  film are the only client islands.
*/

/*
  The immutable snapshot projections are shared across `/` and `/ko` renders. Both routes stay
  `force-dynamic` so their commercial posture is resolved for each request.
*/
type HomeData = {
  home: EvidenceCase | null;
  /** "What you receive": the first sample claim `selectReceiveClaim` accepts. */
  record: ReceiveRecord;
  recompile: RecompileView;
};
let homeMemo: HomeData | undefined;
function homeData(): HomeData {
  return (homeMemo ??= {
    home: selectHomeCase([buildHomeEvidenceCase(buildHeroView(), buildProofTabs()), HOME_RESERVED_CASE]),
    record: buildReceiveRecord(),
    recompile: buildRecompileView(),
  });
}


/*
  Round 2 (CRITIQUE-R1 #2): "What you receive" shows the passage s2 opened on, read from the same evidence
  case: its extractor text exactly as stored, the source fields and the committed page it was cut from.
  Null exactly when s2 has nothing to show (no case, no extracted region); s3 then prints no record rather
  than a different one.
*/
export type ReceivePassage = {
  kindLabel: string;
  unedited: string;
  /** Round 3: the label over the citation view. */
  citationLabel: string;
  /** The World's evidence id for the region -- the `evidenceId` an Ask citation carries. */
  evidenceId: string;
  passage: string;
  truncated: boolean;
  sourceTokens: string[];
  page: number;
  pageCount: number | null;
  bbox1000: readonly number[];
  digest: string;
};
export function receiveFromCase(view: EvidenceCase | null, korean: boolean): ReceivePassage | null {
  if (!view) return null;
  const regions = displayableRegions(view);
  const region = regions.find(item => item.id === view.selectedRegionId) ?? regions[0];
  const source = view.sources.find(item => item.id === region?.sourceId);
  if (!region || !source || region.passage === null) return null;
  return {
    kindLabel: korean ? "기존 추출 구절" : "Existing extracted passage",
    unedited: korean ? "판독기 출력, 수정 없음" : "Reader output, unedited",
    citationLabel: korean ? "Ask 인용 필드" : "As an Ask citation",
    evidenceId: region.id,
    passage: region.passage,
    truncated: region.passageTruncated,
    sourceTokens: [source.filename, source.form, source.filingDate].filter((token): token is string => Boolean(token)),
    page: region.page,
    pageCount: source.pageCount,
    bbox1000: region.bbox1000,
    digest: region.digest,
  };
}

/*
  Round 3 (CRITIQUE-R2 #2): what a reader receives is a record, not a second look at s2's page. So s3 prints
  the passage in the shape an answer carries it -- four of the fields every Ask citation has (VerifiedCitation /
  PacketCitation; the docs' Ask example reads `pageNumber1` and `bbox1000`), each filled from this sample record.
  Field names only; no value here is computed, and nothing is added that the record does not hold.
*/
export function citationText(receive: ReceivePassage): string {
  return [
    "{",
    `  "evidenceId": ${JSON.stringify(receive.evidenceId)},`,
    `  "pageNumber1": ${receive.page},`,
    `  "bbox1000": [${receive.bbox1000.join(", ")}],`,
    `  "excerpt": ${JSON.stringify(receive.passage + (receive.truncated ? "…" : ""))}`,
    "}",
  ].join("\n");
}

/*
  The words only this composition says, in both languages. No figure in any of them: every digit
  on Home is read from the World and printed inside a `data-derived` element.
*/
const HOME_COPY = {
  en: {
    /* FINAL-SPEC 2026-10-26 D-2 (founder veto open): the page-and-region binding, eight words. */
    support: "Each statement keeps its source page and region.",
    /* Not rendered on Home since FINAL-SPEC 2026-10-26 (F-1); the copy deck's intake sentence, kept as the one spelling. */
    intake: "We arrange intake for your own sources with you.",
    bringOwn: "Evaluate your documents",
    receive: {
      /* Review 2026-10-26 B-1: the section's name, as the reader guide called it ("What you receive"). */
      title: "What you receive.",
      kind: (kind: string) => kind,
      /* F-3: the rights sentence, verbatim. Printed under the s2 source window (orchestrator decision 2026-10-26). */
      rights:
        "The sources shown are public filings already published in this site's sample. Other sources need rights clearance before they appear here.",
    },
  },
  ko: {
    // FINAL-SPEC 2026-10-26 D-2: the Korean of the same line (D12 literal translation).
    support: "각 진술에 원문 페이지와 영역이 남습니다.",
    // The copy deck's Korean for the same intake sentence (lib/landing-v2-copy.ts, hero.support).
    intake: "내 자료의 연결과 컴파일은 상담 후 함께 설정합니다.",
    bringOwn: "내 문서 평가",
    receive: {
      title: "이런 기록을 받습니다.",
      kind: (kind: string) => (kind === "Claim" ? "진술" : kind),
      rights:
        "보여 주는 원문은 이 사이트의 샘플에 이미 게시된 공개 공시 문서입니다. 다른 원문은 권리 허가를 거친 뒤에만 여기에 표시됩니다.",
    },
  },
};

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
  /*
    P2-08 / P2-32: what this request asked for with SPECIMEN_FIXTURE_COOKIE -- "1" for the synthetic
    fixtures, "committed" for the committed receipts. Only the local test server honours either
    (lib/specimen-sources.ts); everywhere else the rollout switch decides.
  */
  specimenRequest,
  children,
}: {
  korean?: boolean;
  experiment?: LandingVariantState;
  specimenRequest?: string;
  /** `/ko`'s document-language effect and breadcrumb. Rendered inside the landmark, as today. */
  children?: React.ReactNode;
}) {
  const copy = landingV2Copy(korean);
  const data = homeData();
  const locale = korean ? "ko" : "en";
  const page = HOME_COPY[locale];
  const { home } = data;
  const receive = receiveFromCase(home, korean);
  const specimens = homeSpecimens({ fixtures: specimenRequest === "1", committed: specimenRequest === "committed" });

  /*
    A reader can inspect the sample before choosing a plan. The access action is resolved from
    the current commercial state rather than written here. While that state resolves to
    `/contact`, the hero's access action is the document evaluation instead. The close repeats
    the sample action (`SAMPLE_CTA`, also the header's) beside its price link in `./scenes/start`.
  */
  const heroActions = {
    exploreLabel: korean ? SAMPLE_CTA.ko : SAMPLE_CTA.label,
    exploreHref: SAMPLE_CTA.href,
  };
  const access = primaryCallToAction();
  const heroStart = {
    // Conversion pass 2026-11-09: the hero has room for the allowance the start action opens.
    label: access.href === "/contact" ? page.bringOwn : korean ? KO_CHROME.cta[access.href] : access === SELF_SERVE_CTA ? START_FREE_LABEL : access.label,
    href: access.href === "/contact" ? (korean ? "/ko/evaluation" : "/evaluation") : access.href,
  };

  return (
    <div className={`page lv2 ${sourceStyles.home}`} lang={korean ? "ko" : "en"} data-template="T0">
      {/*
        The Latin file (split.90) is preloaded by the root layout on every route (B-02). /ko adds the
        two static instances of its Hangul subset (FINAL-SPEC 2026-10-26 §3.3, app/wanted-sans-korean.css)
        in place of four of the 90 optional splits: one face for every syllable the page can render.
      */}
      {korean ? <>
        <link rel="preload" as="font" type="font/woff2" href="/fonts/wanted-sans-ko-home-400.woff2" crossOrigin="" />
        <link rel="preload" as="font" type="font/woff2" href="/fonts/wanted-sans-ko-home-510.woff2" crossOrigin="" />
      </> : null}
      <PublicSiteHeader korean={korean} ghostCta start={heroStart} />
      <main id="main" tabIndex={-1} data-home-ia="outcome-v1.1">
        {children}
        {/*
          D7: the landing's whole funnel, in one mounted listener that renders nothing (§30).
          It is inside `main` because that is what it listens to -- the site chrome above and
          below is every page's, not this page's. `variant` is undefined while no test runs, and
          no event then carries the property at all.
        */}
        <LandingAnalytics variant={experiment.tracked} />

        {/* s1: the statement, one filled action and the quieter one, then the compile film. */}
        <section
          id="s1"
          data-scene="1"
          tabIndex={-1}
          aria-labelledby="lv2-hero-title"
          className="lv2-scene lv2-hero"
        >
          <div className="lv2-wrap">
            <div className={sourceStyles.intro}>
              <HeroStatement
                copy={{ ...copy.hero, eyebrow: "", headlineExperiment: undefined, support: page.support }}
                titleId="lv2-hero-title"
                headlineVariant={experiment.headlineVariant}
                keep={korean ? ["인용할 수 있는", "맥락으로 바꿉니다."] : undefined}
              >
                <div className={sourceStyles.heroAside} data-testid="landing-hero-actions">
                    <HeroActions {...heroActions} startLabel={heroStart.label} startHref={heroStart.href}
                      scene="1" ctaOrderVariant={experiment.ctaOrderVariant} entry />
                </div>
                {/* The film's poster is the first screen's priority image: the specimen strip closes s2. */}
                <HeroFilm korean={korean} />
                {/* Direction C round 2: below 900px the page s2 opens on, in place of the film (hero-still.tsx). */}
                {PHONE_HERO === "still" ? <HeroStill view={home} korean={korean} /> : null}
              </HeroStatement>
            </div>
          </div>
        </section>

        {/* Release 3 move 7: measured figures with their denominators and receipts, under the hero. */}
        <HomeMeasures korean={korean} />

        {/*
          s2: one passage followed to its source. The workbench's own title is the section's h2, and
          its status line says what was and was not run. The rights sentence sits under the page.
        */}
        <section
          id="s2"
          data-scene="2"
          tabIndex={-1}
          aria-labelledby="lv2-difficulty-title"
          className={`lv2-scene lv2-paper ${heroStyles.sourceScene}`}
        >
          <div className="lv2-wrap">
            {home ? <HeroSourceCard view={home} korean={korean} titleId="lv2-difficulty-title" rightsNote={page.receive.rights} /> : null}
            {/*
              P2-08 / UX-L4, moved by hard-proof 2026-10-27 (FINAL-SPEC-HARD-PROOF §2, over D-03's place
              in s1): real pages beside the reader's text, after the workbench. No heading of its own,
              so the page keeps six h2. Nothing renders until a receipt does.
            */}
            <SpecimenStrip specimens={specimens} korean={korean} />
          </div>
        </section>

        {/*
          s3: the record a reader receives -- one record of the published sample World, its region cut
          from the page, its quote, and four fields. Its status is the World's own word; nothing here is
          presented as verified. No link: s2's "Open in Explore" is the same move.
        */}
        <section
          id="s3"
          data-scene="3"
          tabIndex={-1}
          aria-labelledby="lv2-receive-title"
          className={`lv2-scene lv2-paper ${heroStyles.receive}`}
        >
          <div className="lv2-wrap">
            <h2 className="lv2-h2" id="lv2-receive-title">{page.receive.title}</h2>
            {/*
              Round 2 (CRITIQUE-R1 #2): what a reader receives, shown with the passage s2 opened on -- the 10-Q
              page-4 operating-expenses row -- instead of the first sentence the claim rule accepted (a 10-K
              fiscal-calendar disclaimer). It is labelled as what the sample records it to be, an existing
              extracted passage, and printed as the reader returned it: mono, unedited, never re-set as a
              table. Beside it, the region cut from the same committed page. Every figure is [data-derived].
            */}
            {receive ? (
            <article className={`${heroStyles.recordSheet} ${heroStyles.recordTwo}`} aria-labelledby="lv2-record-kind" data-receive="passage">
              <div className={heroStyles.recordText}>
                <p className={heroStyles.recordKind} id="lv2-record-kind">
                  <span>{receive.kindLabel}</span>
                </p>
                <dl className={heroStyles.recordFields}>
                  <div>
                    <dt>{copy.evidence.fields.source}</dt>
                    <dd data-derived="1" lang="en">
                      {receive.sourceTokens.map((token, index, tokens) => (
                        <Fragment key={index}>
                          {index > 0 ? " " : null}
                          <span className={heroStyles.recordToken}>{index < tokens.length - 1 ? `${token} ·` : token}</span>
                        </Fragment>
                      ))}
                    </dd>
                  </div>
                  {/* Round 3: page and region are not repeated here; the citation beside it carries them
                      as pageNumber1 and bbox1000, and the word budget is not raised to say them twice. */}
                  <div>
                    <dt>{copy.evidence.fields.version}</dt>
                    <dd><code data-derived="1">{receive.digest}</code></dd>
                  </div>
                </dl>
              </div>
              {/* Round 3: the reader's output, unedited, inside the citation it travels in. */}
              <figure className={heroStyles.citation} data-receive="citation">
                <figcaption className={heroStyles.readerLabel}>{receive.citationLabel}</figcaption>
                <pre className={heroStyles.citationCode} lang="en" data-derived="1" aria-label={receive.unedited}>{citationText(receive)}</pre>
              </figure>
            </article>
            ) : null}
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
        <StartScene locale={locale} copy={copy.start} actions={heroActions} sectionId="s6" sceneIndex={6} />
      </main>
      <PublicSiteFooter korean={korean} compact />
    </div>
  );
}
