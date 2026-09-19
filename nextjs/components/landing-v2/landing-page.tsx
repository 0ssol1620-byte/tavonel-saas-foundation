import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-site-chrome";
import HeroFilm from "./hero-film";
import HeroStatement from "./hero-statement";
import LandingAnalytics from "./landing-analytics";
import EvidenceScene from "./scenes/evidence";
import ProofScene from "./scenes/proof";
import RecompileScene from "./scenes/recompile";
import SourcesScene from "./scenes/sources";
import StartScene from "./scenes/start";
import TrustScene from "./scenes/trust";
import UseScene from "./scenes/use";
import WhyScene from "./scenes/why";
import { KO_EXPLORE_LABEL, WORKSPACE_LABEL } from "./scene-actions";
import { primaryCallToAction } from "@/lib/commercial-state";
import { landingV2Copy } from "@/lib/landing-v2-copy";
import {
  buildEvidenceRecord,
  buildProofTabs,
  buildRecompileView,
  type EvidenceRecord,
  type ProofTab,
  type RecompileView,
} from "@/lib/landing-v2-proof";
import { EXPLORE_CTA, KO_CHROME } from "@/lib/site-navigation";
import { landingVariantState, type LandingVariantState } from "@/lib/landing-experiments";

/*
  Landing V2 (blueprint 2026-09-19, contract D1/D9/D10/D11). One composition, two languages.

  Nine scenes in §9's order, each one a named focusable landmark answering a single question, on
  the ground alternation D9 sets: obsidian hero, paper proof, and on down to an obsidian close.

  WHERE THE SCENES LIVE
  The hero is built here because it is the only scene whose text column, action row and demo are
  three separate components the page has to compose. Scenes 02-09 are each a whole `<section>` of
  their own under `./scenes/`, and each one owns its id, its `data-scene` index (read from
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
  without this the three builders would run the collection compiler on every request to the two
  most-visited routes. The World behind them is frozen at build time and every builder is pure
  over it, so a module-level memo is the whole of what is needed -- not a cache with an
  invalidation story, because there is nothing that can change it while the process lives.
  (`lib/landing-v2-sources.ts` already memoizes its own, which is why Scene 03 is not here.)
*/
type ProofData = { tabs: ProofTab[]; record: EvidenceRecord; recompile: RecompileView };
let proofMemo: ProofData | undefined;
function proofData(): ProofData {
  return (proofMemo ??= {
    tabs: buildProofTabs(),
    record: buildEvidenceRecord(),
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
  const accessLabel = korean ? KO_CHROME.cta[access.href] ?? access.label : access.label;
  const heroActions = {
    exploreLabel: korean ? KO_EXPLORE_LABEL : EXPLORE_CTA.label,
    exploreHref: EXPLORE_CTA.href,
    accessLabel,
    accessHref: access.href,
    workspaceLabel: WORKSPACE_LABEL[locale],
  };

  return (
    <div className="page lv2" lang={korean ? "ko" : undefined}>
      <PublicSiteHeader cta={access} korean={korean} />
      <main id="main" tabIndex={-1}>
        {children}
        {/*
          D7: the landing's whole funnel, in one mounted listener that renders nothing (§30).
          It is inside `main` because that is what it listens to -- the site chrome above and
          below is every page's, not this page's. `variant` is undefined while no test runs, and
          no event then carries the property at all.
        */}
        <LandingAnalytics variant={experiment.tracked} />

        {/*
          01 Hero -- FOUNDER DECISION 2026-09-20: one centered statement, then one visual.

          This is the reference pattern, not §11.1's asymmetric split: the competitor captures in
          `reports/landing-v2-0919/compare/` all open with a centered block and put the product
          picture under it, and the founder asked for the same shape with the four compile films
          back as the picture. `lv2-scene--full` is gone with the split -- a hero that is a
          statement plus a film is taller than a viewport by construction, and a `min-height` that
          reserved one would only add ground between the two.
        */}
        <section
          id="hero"
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
                D8 Test 02 applies to the hero row only. Scene 09's close keeps the access action
                filled on both arms: that is §19's composition and not the variable under test,
                and swapping two rows at once would make the result unattributable.
              */
              actions={{ ...heroActions, scene: "1", ctaOrderVariant: experiment.ctaOrderVariant }}
            />
            <HeroFilm korean={korean} />
          </div>
        </section>

        {/* 02-09. Each scene is its own landmark; the order here is §9's and D9's. */}
        <ProofScene locale={locale} copy={copy.proof} data={proof.tabs} />
        <SourcesScene locale={locale} copy={copy.sources} />
        <EvidenceScene locale={locale} copy={copy.evidence} data={proof.record} />
        <RecompileScene locale={locale} copy={copy.recompile} data={proof.recompile} />
        <WhyScene locale={locale} copy={copy.why} />
        <UseScene locale={locale} copy={copy.use} />
        <TrustScene locale={locale} copy={copy.trust} />
        <StartScene locale={locale} copy={copy.start} actions={heroActions} />
      </main>
      <PublicSiteFooter korean={korean} />
    </div>
  );
}
