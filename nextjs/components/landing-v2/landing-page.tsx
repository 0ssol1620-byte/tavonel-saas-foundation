import {
  PublicSiteFooter,
  PublicSiteHeader,
} from "@/components/public-site-chrome";
import CompilerSpecimen from "./compiler-specimen";
import HeroFilm from "./hero-film";
import HeroActions from "./hero-actions";
import HeroProof from "./hero-proof";
import HeroStatement from "./hero-statement";
import LandingAnalytics from "./landing-analytics";
import ProofScene from "./scenes/proof";
import RecompileScene from "./scenes/recompile";
import StartScene from "./scenes/start";
import TrustScene from "./scenes/trust";
import { KO_EXPLORE_LABEL } from "./scene-actions";
import { landingV2Copy } from "@/lib/landing-v2-copy";
import {
  buildProofTabs,
  buildRecompileView,
  type ProofTab,
  type RecompileView,
} from "@/lib/landing-v2-runtime";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import { KO_CHROME } from "@/lib/site-navigation";
import { primaryCallToAction } from "@/lib/commercial-state";
import {
  landingVariantState,
  type LandingVariantState,
} from "@/lib/landing-experiments";

/*
  Landing V2 (blueprint 2026-09-19, contract D1/D9/D10/D11). One composition, two languages.

  Six beats move from the source-linked specimen through public proof, change, trust, and close.

  WHERE THE SCENES LIVE
  The hero is built here because it is the only scene whose text column, action row and demo are
  three separate components the page has to compose. The remaining beats are each a whole
  `<section>` of their own under `./scenes/`, and each owns its id and `data-scene` index (read from
  `LANDING_V2_SCENE_ORDER`, never typed), its ground class and its one next action. This file
  therefore no longer carries a generic `Scene()` shell: a shell that renders a heading and a link
  is exactly what the eight scene lanes replaced, and keeping it would have left two places that
  decide what a scene's landmark looks like.

  WHY THIS IS A SERVER COMPONENT
  The public World is compiled into a committed snapshot and checked against the source at build
  time. This component reads the snapshot and hands each scene a flat, serializable projection.
  Browser interactions stay in the action row and the specimen's play/pause control.
*/

/*
  The immutable snapshot projections are shared across `/` and `/ko` renders. Both routes stay
  `force-dynamic` so their commercial posture is resolved for each request.
*/
type ProofData = {
  tabs: ProofTab[];
  recompile: RecompileView;
};
let proofMemo: ProofData | undefined;
function proofData(): ProofData {
  return (proofMemo ??= {
    tabs: buildProofTabs(),
    recompile: buildRecompileView(),
  });
}

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
  const proof = proofData();
  const locale = korean ? "ko" : "en";

  /* A reader can inspect the sample before choosing a plan. */
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
  const specimenCopy = korean
    ? { eyebrow: "작동 방식", title: "한 원문이 지식이 되는 다섯 단계" }
    : { eyebrow: "How it compiles", title: "One source. Five transformations." };
  const sampleCopy = korean
    ? { eyebrow: "공개 샘플", title: "원문과 결과를 직접 확인하세요." }
    : { eyebrow: "Public sample", title: "Inspect the result and its source." };

  return (
    <div className="page lv2" lang={korean ? "ko" : undefined}>
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
          01 Hero -- one centered statement, then the product itself on the public sample World.

          The first visual is a source-linked specimen that opens on its Evidence stage.
          The public sample inspector and film follow in Scene 02.
        */}
        <section
          id="s1"
          data-scene="1"
          tabIndex={-1}
          aria-labelledby="lv2-hero-title"
          className="lv2-scene lv2-obsidian lv2-hero"
        >
          <div className="lv2-wrap">
            <HeroStatement
              copy={copy.hero}
              titleId="lv2-hero-title"
              /* D3 allows the serif on one phrase of the H1; Instrument Serif has no Hangul. */
              accent={korean ? undefined : "Knowledge you can verify"}
              headlineVariant={experiment.headlineVariant}
            />
            <HeroActions
              exploreLabel={heroActions.exploreLabel}
              exploreHref={heroActions.exploreHref}
              pricingLabel={korean ? "요금 보기" : "View pricing"}
              pricingHref={korean ? "/ko/pricing" : "/pricing"}
              scene="1"
              ctaOrderVariant={experiment.ctaOrderVariant}
            />
            <p className="lv2-hero-intake lv2-meta">
              {korean ? copy.hero.microProofFormats.replace(" or ", " 또는 ") : copy.hero.microProofFormats}{" "}
              <span className="lv2-hero-intake-tail">· {copy.hero.microProofConnected}</span>
            </p>
            <div className="lv2-scene-head lv2-how-head">
              <p className="lv2-eyebrow lv2-meta">{specimenCopy.eyebrow}</p>
              <h2 className="lv2-h2" id="lv2-how-title">{specimenCopy.title}</h2>
            </div>
            <CompilerSpecimen korean={korean} />
          </div>
        </section>

        {/*
          02 Public sample -- the Evidence Inspector over the committed World, then the
          four-cut film as an optional deeper explanation.
        */}
        <section
          id="s2"
          data-scene="2"
          tabIndex={-1}
          aria-labelledby="lv2-s2-title"
          className="lv2-scene lv2-obsidian"
        >
          <div className="lv2-wrap">
            <div className="lv2-scene-head">
              <p className="lv2-eyebrow lv2-meta">{sampleCopy.eyebrow}</p>
              <h2 className="lv2-h2" id="lv2-s2-title">{sampleCopy.title}</h2>
            </div>
            <HeroProof korean={korean} />
            <HeroFilm korean={korean} />
          </div>
        </section>

        <ProofScene locale={locale} copy={copy.proof} data={proof.tabs} sectionId="s3" sceneIndex={3} />
        <RecompileScene
          locale={locale}
          copy={copy.recompile}
          data={proof.recompile}
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
