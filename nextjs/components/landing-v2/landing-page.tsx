import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-site-chrome";
import HeroFilm from "./hero-film";
import HeroActions from "./hero-actions";
import HeroSourceCard from "./hero-source-card";
import HeroStatement from "./hero-statement";
import HomeMeasures from "./home-measures";
import heroStyles from "./landing-hero.module.css";
import sourceStyles from "./source-first-home.module.css";
import LandingAnalytics from "./landing-analytics";
import SpecimenStrip from "./specimen-strip";
import { SourceRegionWindow } from "./source-region";
import RecompileScene from "./scenes/recompile";
import StartScene from "./scenes/start";
import TrustScene from "./scenes/trust";
import { landingV2Copy } from "@/lib/landing-v2-copy";
import { landingV2PageImage } from "@/lib/landing-v2-assets";
import { excerptPreview } from "@/lib/explore-entry-proof";
import {
  buildHeroView,
  buildProofTabs,
  buildReceiveRecord,
  buildRecompileView,
  landingV2StateWord,
  type ReceiveRecord,
  type RecompileView,
} from "@/lib/landing-v2-runtime";
import {
  buildHomeEvidenceCase,
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

/**
 * Home's quote length for the record (FINAL-SPEC §2.4). §2.9 lever 1: the measured page was over the word
 * budget, so the quote drops from 160 to 120 characters. Same record, same rule, the source text is not
 * edited; `EXCERPT_LIMIT` (240) stays for its other callers.
 */
export const RECORD_EXCERPT = 120;

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
      title: "You receive a record like this.",
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
  const { home, record } = data;
  const quote = excerptPreview(record.claim.label, RECORD_EXCERPT);
  /* The record's own page raster, by the same digest and page the record builder bound it to. */
  const recordPage = landingV2PageImage(record.version.digest, record.source.page);
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
    label: access.href === "/contact" ? page.bringOwn : korean ? KO_CHROME.cta[access.href] : access.label,
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
      <PublicSiteHeader korean={korean} ghostCta />
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
              >
                <div className={sourceStyles.heroAside} data-testid="landing-hero-actions">
                    <HeroActions {...heroActions} startLabel={heroStart.label} startHref={heroStart.href}
                      scene="1" ctaOrderVariant={experiment.ctaOrderVariant} />
                </div>
                {/*
                  P2-08 / UX-L4 (UX-PLAN §3.2-§3.3; critic D-03's default place): real pages beside
                  the reader's text, between the actions and the illustrative film. Nothing renders
                  until a receipt does.
                */}
                <SpecimenStrip specimens={specimens} korean={korean} />
                <HeroFilm korean={korean} priority={specimens.length === 0} />
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
            <article className={heroStyles.recordSheet} aria-labelledby="lv2-record-kind">
              <p className={heroStyles.recordKind} id="lv2-record-kind">
                <span>{page.receive.kind(record.claim.kind)}</span>
                <span className={heroStyles.recordState}>{landingV2StateWord(record.status.state, locale)}</span>
              </p>
              {recordPage ? (
                <SourceRegionWindow
                  className={heroStyles.recordCrop}
                  image={recordPage}
                  bbox1000={record.region.bbox1000}
                  sizes="(min-width: 900px) 886px, calc(100vw - 88px)"
                />
              ) : null}
              <blockquote className={heroStyles.recordQuote} lang="en" data-derived="1">
                {quote.text}{quote.truncated ? "…" : ""}
              </blockquote>
              <dl className={heroStyles.recordFields}>
                <div>
                  <dt>{copy.evidence.fields.source}</dt>
                  <dd data-derived="1" lang="en">{record.source.filename} · {record.source.form} · {record.source.filingDate}</dd>
                </div>
                <div>
                  <dt>{copy.evidence.fields.page}</dt>
                  <dd data-derived="1">
                    {korean
                      ? `${record.source.pageCount}쪽 중 ${record.source.page}쪽`
                      : `${record.source.page} of ${record.source.pageCount}`}
                  </dd>
                </div>
                <div>
                  <dt>{copy.evidence.fields.region}</dt>
                  <dd><span data-derived="1">bbox {record.region.bbox1000.join(",")}</span></dd>
                </div>
                <div>
                  <dt>{copy.evidence.fields.version}</dt>
                  <dd><code data-derived="1">{record.version.digest}</code></dd>
                </div>
              </dl>
            </article>
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
