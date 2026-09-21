import {
  PublicSiteFooter,
  PublicSiteHeader,
} from "@/components/public-site-chrome";
import CompilerSpecimen from "./compiler-specimen";
import HeroFilm from "./hero-film";
import HeroProof from "./hero-proof";
import HeroStatement from "./hero-statement";
import LandingAnalytics from "./landing-analytics";
import ProofScene from "./scenes/proof";
import RecompileScene from "./scenes/recompile";
import StartScene from "./scenes/start";
import TrustScene from "./scenes/trust";
import { KO_EXPLORE_LABEL, WORKSPACE_LABEL } from "./scene-actions";
import { primaryCallToAction } from "@/lib/commercial-state";
import { landingV2Copy } from "@/lib/landing-v2-copy";
import {
  buildProofTabs,
  buildRecompileView,
  type ProofTab,
  type RecompileView,
} from "@/lib/landing-v2-runtime";
import { EXPLORE_CTA, KO_CHROME } from "@/lib/site-navigation";
import {
  landingVariantState,
  type LandingVariantState,
} from "@/lib/landing-experiments";

/*
  Landing V2 (blueprint 2026-09-19, contract D1/D9/D10/D11). One composition, two languages.

  Six beats move from the hero film through the compiler specimen, proof, change, trust, and close.

  WHERE THE SCENES LIVE
  The hero is built here because it is the only scene whose text column, action row and demo are
  three separate components the page has to compose. The remaining beats are each a whole
  `<section>` of their own under `./scenes/`, and each owns its id and `data-scene` index (read from
  `LANDING_V2_SCENE_ORDER`, never typed), its ground class and its one next action. This file
  therefore no longer carries a generic `Scene()` shell: a shell that renders a heading and a link
  is exactly what the eight scene lanes replaced, and keeping it would have left two places that
  decide what a scene's landmark looks like.

  WHY THIS IS A SERVER COMPONENT
  The data builders run the collection compiler through `lib/explore-sample.ts`, which is
  server-only. The old landing was a client component that took two scalars as props; this one
  reads the compiled public World and hands each scene a flat, serializable projection of it. The
  two things that genuinely need a browser -- the session-aware action row and the demo's
  play/pause control -- are the two client components this file renders.

  The consequence worth naming: the header no longer knows whether the reader is signed in. It
  did on the old landing and on no other page of the site, and the inconsistency is resolved
  toward the site rather than toward this page. The hero's own action row still resolves it,
  which is where it changes what a reader is offered.
*/

/*
  The compiled World's projections, read once per process rather than once per render.

  `/` and `/ko` are `force-dynamic` (the commercial posture has to be resolved per request), so
  without this the two builders would run the collection compiler on every request to the two
  most-visited routes. The World behind them is frozen at build time and every builder is pure
  over it, so a module-level memo is the whole of what is needed -- not a cache with an
  invalidation story, because there is nothing that can change it while the process lives.
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

  /*
    The commercial posture, resolved on the server (BA-232). `primaryCallToAction()` chooses
    between the site's two access actions; nothing here writes a third, and the Korean label is
    that action's own, keyed by destination in `KO_CHROME.cta`.
  */
  const access = primaryCallToAction();
  const accessLabel = korean
    ? (KO_CHROME.cta[access.href] ?? access.label)
    : access.label;
  const heroActions = {
    exploreLabel: korean ? KO_EXPLORE_LABEL : EXPLORE_CTA.label,
    exploreHref: EXPLORE_CTA.href,
    accessLabel,
    accessHref: access.href,
    workspaceLabel: WORKSPACE_LABEL[locale],
  };
  const specimenCopy = korean
    ? { eyebrow: "작동 방식", title: "한 원문이 지식이 되는 다섯 단계" }
    : { eyebrow: "How it compiles", title: "One source. Five transformations." };

  return (
    <div className="page lv2" lang={korean ? "ko" : undefined}>
      <PublicSiteHeader cta={access} korean={korean} />
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

          2026-09-22, gap #1. What sat here was the four-cut film: a recording of the product,
          above the fold, on the one page where a reader decides whether this works. The film is
          not removed -- it moves into Scene 02, the "How it compiles" landmark it was always
          explaining -- and the hero now carries `HeroProof`: the same Evidence Inspector panel
          /evidence and /product/document-understanding already share, live, with no login, over
          the public sample World, and the four counts that World actually holds under it.

          The founder's 2026-09-20 composition is unchanged: one centered statement, then one
          visual. Which visual it is, is what changed.
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
              accent={korean ? undefined : "every source"}
              headlineVariant={experiment.headlineVariant}
              /*
                D8 Test 02 applies to the hero row only. The close keeps the access action
                filled on both arms: that is §19's composition and not the variable under test,
                and swapping two rows at once would make the result unattributable.
              */
              actions={{
                ...heroActions,
                scene: "1",
                ctaOrderVariant: experiment.ctaOrderVariant,
              }}
            />
            <HeroProof korean={korean} />
          </div>
        </section>

        {/*
          02 How it compiles -- the four-cut film, then one committed public source through five
          transformations. The film leads because it is the overview and the specimen is the
          detail; both are now in the landmark whose heading says they are the explanation.
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
              <p className="lv2-eyebrow lv2-meta">{specimenCopy.eyebrow}</p>
              <h2 className="lv2-h2" id="lv2-s2-title">{specimenCopy.title}</h2>
            </div>
            <HeroFilm korean={korean} />
            <CompilerSpecimen korean={korean} />
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
        <StartScene locale={locale} copy={copy.start} actions={heroActions} sectionId="s6" sceneIndex={6} />
      </main>
      <PublicSiteFooter korean={korean} />
    </div>
  );
}
