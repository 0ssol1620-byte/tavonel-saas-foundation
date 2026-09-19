import Link from "next/link";
import type { Route } from "next";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-site-chrome";
import HeroActions from "./hero-actions";
import HeroCompilerDemo from "./hero-compiler-demo";
import HeroStatement from "./hero-statement";
import { HERO_PAGE_ALT, KO_EXPLORE_LABEL, SCENE_ACTIONS, WORKSPACE_LABEL } from "./scene-actions";
import { activationPolicy } from "@/lib/activation-policy";
import { primaryCallToAction } from "@/lib/commercial-state";
import {
  landingV2Copy,
  LANDING_V2_SCENE_ORDER,
  type LandingV2Scene,
  type LandingV2SceneId,
} from "@/lib/landing-v2-copy";
import { buildHeroScene, type HeroScene } from "@/lib/landing-v2-hero";
import { LANDING_V2_STATE_WORD } from "@/lib/landing-v2-proof";
import { sourcePageLabel } from "@/lib/source-page-rasters";
import { EXPLORE_CTA, KO_CHROME } from "@/lib/site-navigation";

/*
  Landing V2 (blueprint 2026-09-19, contract D1/D9/D10/D11). One composition, two languages.

  Nine scenes in §9's order, each one a named focusable landmark answering a single question, on
  the ground alternation D9 sets: obsidian hero, paper proof, and on down to an obsidian close.
  The hero is built in full here; scenes 02-09 carry their final copy and one next action each,
  and each is shaped so its visual drops into the second half of the split without the scene's
  markup moving (P1/P2).

  WHY THIS IS A SERVER COMPONENT
  `buildHeroScene()` runs the collection compiler through `lib/explore-sample.ts`, which is
  server-only. The old landing was a client component that took two scalars as props; this one
  reads the compiled public World and hands the demo a flat, serializable projection of it. The
  two things that genuinely need a browser -- the session-aware action row and the demo's
  play/pause control -- are the two client components this file renders.

  The consequence worth naming: the header no longer knows whether the reader is signed in. It
  did on the old landing and on no other page of the site, and the inconsistency is resolved
  toward the site rather than toward this page. The hero's own action row still resolves it,
  which is where it changes what a reader is offered.
*/

/** What the hero image's `sizes` attribute says, shared with the preload in `app/page.tsx`. */
export const HERO_IMAGE_SIZES = "(min-width: 1200px) 320px, (min-width: 768px) 420px, min(320px, 84vw)";

/*
  The hero scene, read once per process rather than once per render.

  `/` and `/ko` are `force-dynamic` (the commercial posture has to be resolved per request), and
  both this component and `app/page.tsx`'s preload need the same source raster. The World behind
  `buildHeroScene()` is frozen at build time and the function is pure over it, so a module-level
  memo is the whole of what is needed here -- not a cache with an invalidation story, because
  there is nothing that can change it while the process lives.
*/
let memo: HeroScene | undefined;
export function heroScene(): HeroScene {
  return (memo ??= buildHeroScene());
}

/*
  D9's ground alternation, as data rather than as nine class names typed nine times. "paper" is
  the light document layer (§5.1) and carries its own remapped accents; see `app/landing-v2.css`.
*/
const GROUND: Record<LandingV2SceneId, "obsidian" | "paper"> = {
  hero: "obsidian",
  proof: "paper",
  sources: "obsidian",
  evidence: "paper",
  recompile: "obsidian",
  why: "paper",
  use: "obsidian",
  trust: "paper",
  start: "obsidian",
};

/**
 * One scene: eyebrow, heading, support, an optional qualifier, and one thing to do next.
 *
 * `visual` is the Editorial Split's second column (§7). While it is absent the text is a single
 * measured column rather than four-of-twelve with eight columns of nothing beside it, so the
 * P0 page reads as finished instead of as a layout waiting for an image.
 */
function Scene({
  scene,
  index,
  children,
  visual,
  serifAccent = false,
}: {
  scene: LandingV2Scene;
  index: number;
  children?: React.ReactNode;
  visual?: React.ReactNode;
  /** D3: the serif is allowed on the §16 manifesto line and nowhere else below the H1. */
  serifAccent?: boolean;
}) {
  const id = scene.id;
  const titleId = `lv2-${id}-title`;
  const head = (
    <div className="lv2-scene-head">
      <p className="lv2-eyebrow lv2-meta">{scene.eyebrow}</p>
      <h2 className="lv2-h2" id={titleId}>
        <span className="lv2-h2-line">{scene.headline}</span>
        {scene.headlineAccent ? (
          <span className={`lv2-h2-line lv2-h2-accent${serifAccent ? " lv2-serif" : ""}`}>{scene.headlineAccent}</span>
        ) : null}
      </h2>
      <p className="lv2-scene-support lv2-body-l">{scene.support}</p>
      {scene.note ? <p className="lv2-scene-note lv2-small">{scene.note}</p> : null}
      {children}
    </div>
  );
  return (
    <section
      id={id}
      data-scene={String(index)}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={`lv2-scene lv2-scene--proof lv2-${GROUND[id as LandingV2SceneId]}`}
    >
      <div className="lv2-wrap">{visual ? <div className="lv2-split">{head}{visual}</div> : head}</div>
    </section>
  );
}

export default function LandingPage({
  korean = false,
  children,
}: {
  korean?: boolean;
  /** `/ko`'s document-language effect and breadcrumb. Rendered inside the landmark, as today. */
  children?: React.ReactNode;
}) {
  const copy = landingV2Copy(korean);
  const scene = heroScene();
  const locale = korean ? "ko" : "en";
  const actionsFor = SCENE_ACTIONS[locale];

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

  const order = LANDING_V2_SCENE_ORDER;
  const sceneIndex = (id: LandingV2SceneId) => order.indexOf(id) + 1;
  const next = (id: Exclude<LandingV2SceneId, "hero" | "start">) => (
    <Link className="lv2-text-link lv2-scene-next" href={actionsFor[id].href as Route} prefetch={false}>
      {actionsFor[id].label}
    </Link>
  );

  return (
    <div className="page lv2" lang={korean ? "ko" : undefined}>
      <PublicSiteHeader cta={access} korean={korean} />
      <main id="main" tabIndex={-1}>
        {children}

        {/* 01 Hero (§10, §11, §32). Text : visual 42 : 58, asymmetric, no film and no video. */}
        <section
          id="hero"
          data-scene="1"
          tabIndex={-1}
          aria-labelledby="lv2-hero-title"
          className="lv2-scene lv2-scene--full lv2-obsidian lv2-hero"
        >
          <div className="lv2-wrap lv2-hero-grid">
            <HeroStatement
              copy={copy.hero}
              titleId="lv2-hero-title"
              /* D3 allows the serif on one phrase of the H1; Instrument Serif has no Hangul. */
              accent={korean ? undefined : "every source"}
              actions={{ ...heroActions, scene: "1" }}
            />
            <HeroCompilerDemo
              scene={scene}
              copy={copy}
              stateLabel={LANDING_V2_STATE_WORD[scene.compiled.state]}
              pageLabel={sourcePageLabel(scene.source.representationKind, korean)}
              pageAlt={HERO_PAGE_ALT[locale]}
              sizes={HERO_IMAGE_SIZES}
            />
          </div>
        </section>

        {/* 02 Instant proof · 03 Sources into a World · 04 Evidence · 05 Recompile */}
        <Scene scene={copy.proof} index={sceneIndex("proof")}>{next("proof")}</Scene>
        <Scene scene={copy.sources} index={sceneIndex("sources")}>{next("sources")}</Scene>
        <Scene scene={copy.evidence} index={sceneIndex("evidence")}>{next("evidence")}</Scene>
        <Scene scene={copy.recompile} index={sceneIndex("recompile")}>
          {/*
            Rule 7. Dependency-aware recompilation is the compiler contract, not what this
            deployment performs: the public sample is five complete compiles compared with one
            another. The qualifier travels with the scene rather than being left to the scene's
            future visual.
          */}
          <p className="lv2-scene-note lv2-small">{copy.recompile.contractNote}</p>
          {next("recompile")}
        </Scene>

        {/* 06 Why a compiler. The §16 manifesto line is the second place D3 allows the serif. */}
        <Scene scene={copy.why} index={sceneIndex("why")} serifAccent>
          {next("why")}
        </Scene>

        {/* 07 Bring it, use it · 08 Trust */}
        <Scene scene={copy.use} index={sceneIndex("use")}>{next("use")}</Scene>
        <Scene scene={copy.trust} index={sceneIndex("trust")}>
          {/*
            The four proofs, rendered, because the sentence above them counts them.

            Scene 08's support is "Four things this deployment does, each written down where it
            can be checked." -- a sentence that was true of the scene P2 will ship and false of
            the one that is deployed, where `Scene()` renders a heading and one link. `§18`'s
            four proofs are four label/note pairs and need no visual to be read, so they are the
            cheap half of making the copy true now rather than softening it and restoring it.

            No figure reaches the page from here: the word "Four" is in the support sentence, and
            `lib/landing-v2-copy.test.ts` holds the count of `trust.proofs` against it.
          */}
          <ul className="lv2-proof-list">
            {copy.trust.proofs.map((proof) => (
              <li key={proof.id} className="lv2-proof">
                <p className="lv2-proof-label">{proof.label}</p>
                <p className="lv2-proof-note lv2-small">{proof.note}</p>
              </li>
            ))}
          </ul>
          {next("trust")}
        </Scene>

        {/* 09 Final CTA. §19's microtext is `activationPolicy.customerData.reason`, verbatim. */}
        <Scene scene={copy.start} index={sceneIndex("start")}>
          <HeroActions {...heroActions} scene="9" />
          <p className="lv2-scene-note lv2-small" data-customer-data={activationPolicy.customerData.enabled ? "open" : "arranged"}>
            {copy.start.microtext}
          </p>
        </Scene>
      </main>
      <PublicSiteFooter korean={korean} />
    </div>
  );
}
