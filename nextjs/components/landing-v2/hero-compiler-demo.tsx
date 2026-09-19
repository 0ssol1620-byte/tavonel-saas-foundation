"use client";

import { useEffect, useId, useRef, useState } from "react";
import CompiledClaim from "./compiled-claim";
import EntityNode from "./entity-node";
import EvidenceLine from "./evidence-line";
import RevisionBadge from "./revision-badge";
import SourcePage from "./source-page";
import type { LandingV2Copy } from "@/lib/landing-v2-copy";
import type { HeroScene } from "@/lib/landing-v2-hero";

/*
  The hero demo (blueprint §11, contract D11): DOM and CSS, no canvas, no video, no SVG.

  WHY THE SEQUENCE IS CSS AND NOT JAVASCRIPT
  The first frame has to be the server's, and the loop has to run before this file has hydrated
  (§27). So every beat is a keyframe animation on a shared 16-second timeline -- 14 seconds of
  beats and a 2-second hold, exactly the storyboard's -- and each element's own keyframes carry
  its window as percentages of that timeline. No delays, no stagger arithmetic, no scheduler:
  elements that start together stay together for as long as the page is open.

  The direction of every animation is the same, and it is the opposite of the obvious one. An
  element's *base* CSS is its finished state, and the keyframes hide it and bring it back. That
  is what makes reduced motion correct rather than approximately correct: `app/landing-v2.css`
  collapses every animation here to 1ms and a single iteration, and a finished CSS animation with
  the default `animation-fill-mode` reverts the element to its base style -- which is the
  composed state §26 asks for. Writing it the other way round would leave a page that never
  arrives and a claim that never compiles.

  WHAT THIS FILE IS FOR
  Three things, and nothing else: the 44px play/pause control, the reduced-motion default, and a
  JavaScript half of the §4.1 signature interaction for engines without `:has()`. The signature
  itself is CSS first, and the fallback writes an attribute straight onto the node rather than
  going through React state -- a hover that re-renders the hero is an INP cost for a decoration,
  and §27's budget is 160ms.

  Every figure on the stage comes from `buildHeroScene()` and is marked `data-derived="1"`, which
  is what `e2e/landing-v2.spec.ts` walks: a digit in this hero that has no receipt fails there.
*/

/**
 * Put the record's figures into a line the copy deck owns.
 *
 * The hero's metadata is half copy and half measurement, and the halves come from different
 * modules on purpose: `lib/landing-v2-copy.ts` may not contain a digit, and
 * `lib/landing-v2-hero.ts` has no locale. So the copy carries `p.{page} of {pageCount}` in one
 * language and `{pageCount}쪽 중 {page}쪽` in the other, and the numbers arrive here. An unknown
 * placeholder is left standing rather than blanked, so a missing key shows up in a screenshot
 * instead of quietly printing a sentence with a hole in it.
 */
function fill(format: string, values: Record<string, string | number>): string {
  return format.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : String(value);
  });
}

export default function HeroCompilerDemo({
  scene,
  copy,
  stateLabel,
  pageLabel,
  pageAlt,
  sizes,
}: {
  scene: HeroScene;
  /* The whole record, not only the hero's: the Recompile beat prints the counts with the nouns
     the Recompile scene owns, and one spelling of "untouched" on the page is the point. */
  copy: LandingV2Copy;
  /** The World's own word for the compiled object's state, resolved on the server. */
  stateLabel: string;
  /** `sourcePageLabel(representationKind, korean)` -- the noun plus its qualifier. */
  pageLabel: string;
  pageAlt: string;
  /** The same string `app/page.tsx` puts on the preload; one source, so they cannot disagree. */
  sizes: string;
}) {
  const [playing, setPlaying] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const countsId = useId();

  useEffect(() => {
    /*
      Reduced motion starts paused, and the control stays (§26). The animations are already
      collapsed to 1ms by the stylesheet, so this is not what stops the movement -- it is what
      makes the control tell the truth about the state it is in.
    */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);

  useEffect(() => {
    /*
      `:has()` is the primary implementation and this is the fallback, so engines that support it
      pay nothing at all -- not a listener, not a render.
    */
    if (typeof CSS !== "undefined" && CSS.supports?.("selector(:has(*))")) return;
    const node = root.current;
    if (!node) return;
    const TRIGGERS = ".lv2-claim, .lv2-node";
    const inside = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(TRIGGERS));
    const enter = (event: Event) => {
      if (inside(event.target)) node.setAttribute("data-signature", "1");
    };
    const leave = (event: Event) => {
      // Moving between two children of the same trigger is not leaving it.
      const next = (event as PointerEvent | FocusEvent).relatedTarget;
      if (inside(event.target) && !inside(next)) node.setAttribute("data-signature", "0");
    };
    node.addEventListener("pointerover", enter);
    node.addEventListener("pointerout", leave);
    node.addEventListener("focusin", enter);
    node.addEventListener("focusout", leave);
    return () => {
      node.removeEventListener("pointerover", enter);
      node.removeEventListener("pointerout", leave);
      node.removeEventListener("focusin", enter);
      node.removeEventListener("focusout", leave);
    };
  }, []);

  const { source, region, compiled, related, change, ask } = scene;
  const hero = copy.hero;
  /*
    §4.1's signature label and the page connective, in the language the page is written in. The
    figures are the record's; the words around them are the copy deck's.
  */
  const regionLabel = fill(hero.regionLabelFormat, {
    form: source.form,
    page: source.page,
    coordinates: region.coordinates,
  });
  const pageOf = fill(hero.pageOfFormat, { page: source.page, pageCount: source.pageCount });
  /*
    The snapshot step, assembled from measurements and the copy deck's words.

    Both labels used to arrive prebuilt from `exploreChangeStory`, where they are typed strings,
    and `RevisionBadge` marked them `data-derived`. The count in the after label is
    `change.arrivals.length` now -- the same array the badge lists underneath it -- so the two
    cannot disagree, and the years come from the filing records rather than from a sentence.
  */
  const beforeLabel = fill(copy.recompile.snapshotBeforeFormat, {
    year: change.before.year,
    form: change.before.form,
  });
  const afterLabel = fill(copy.recompile.snapshotAfterFormat, {
    before: beforeLabel,
    count: change.arrivals.length,
  });
  const beats = [
    hero.beats.source,
    hero.beats.read,
    hero.beats.compile,
    hero.beats.structure,
    hero.beats.verify,
    hero.beats.change,
    hero.beats.recompile,
    hero.beats.use,
  ];

  return (
    <div className="lv2-demo" ref={root} data-playing={playing ? "1" : "0"} data-signature="0">
      <p className="lv2-demo-label lv2-meta" id={labelId}>
        {hero.demoLabel}
      </p>

      <div className="lv2-demo-stage" role="group" aria-labelledby={labelId}>
        {/* 0.0-1.2s Source arrives, 1.2-2.4s the region is read. */}
        <figure className="lv2-src">
          <SourcePage
            src={source.rasterSrc}
            srcSet={source.rasterSrcSet}
            sizes={sizes}
            width={source.width}
            height={source.height}
            alt={pageAlt}
            bbox1000={region.bbox1000}
            regionLabel={regionLabel}
            priority
          />
          <figcaption className="lv2-src-meta">
            <span className="lv2-meta lv2-src-noun">{pageLabel}</span>
            <span className="lv2-meta lv2-src-id" data-derived="1" title={source.digest}>
              {source.form} · {source.filingDate} · {pageOf}
            </span>
            <span className="lv2-meta lv2-region-label" data-derived="1">
              {regionLabel}
            </span>
            {/* The unit those four numbers are in, in the same language as the label above it. */}
            <span className="lv2-meta lv2-src-unit">{copy.evidence.regionUnit}</span>
          </figcaption>
        </figure>

        {/* 2.4-4.0s Compile: the line draws, then the claim arrives bound to the region. */}
        <EvidenceLine />

        <CompiledClaim
          kind={compiled.kind}
          state={compiled.state}
          stateLabel={stateLabel}
          excerpt={compiled.excerpt}
          truncated={compiled.excerptTruncated}
          href={scene.links.evidence}
        />

        {/* 4.0-5.8s Structure. Each row says which node its relation leaves; see `entity-node.tsx`. */}
        <div className="lv2-nodes">
          <ul className="lv2-nodes-list">
            {related.map((node) => (
              <li key={node.id}>
                <EntityNode
                  label={node.label}
                  kind={node.kind}
                  predicate={node.predicate}
                  via={node.via}
                  href={scene.links.world}
                />
              </li>
            ))}
          </ul>
        </div>
        <EvidenceLine tone="relation" className="lv2-line--rel" />

        {/* 7.2-9.5s Change. */}
        <RevisionBadge
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
          arrivalsLabel={copy.recompile.arrivalsLabel}
          arrivals={change.arrivals}
        />

        {/*
          9.5-11.5s Recompile.

          THE HEADING IS WHAT MAKES THESE FIGURES READABLE, and it is not decoration. Contract
          rule 4 allows a figure only when it is "shown with what they count", and the four state
          words underneath -- rebuilt in place, added, removed, untouched -- name the state, not
          the unit. A reader met four bare numbers and could not tell whether they counted
          objects, claims, pages or filings; the noun lived four scenes and some four thousand
          pixels further down.

          THE NOUN IS `compareLabel`, NOT `affectedLabel`, and the difference is the data's.
          `affectedLabel` is "Objects the arrivals reached", and `untouched` -- structurally the
          largest of the four, since rebuilt + added + untouched is every object of the later
          World -- is by definition the objects the arrivals did NOT reach:
          `lib/explore-change.ts` builds `untouchedNodeIds` as the complement of the affected
          set and `explore-change.test.ts` asserts the two never overlap. Under the old heading a
          screen reader read the row as "Objects the arrivals reached, list, N untouched". The
          heading names the partition; the four state words name the sides of it.
        */}
        <div className="lv2-counts">
          <p className="lv2-counts-title lv2-meta" id={countsId}>
            {copy.recompile.compareLabel}
          </p>
          <ul className="lv2-counts-list" aria-labelledby={countsId}>
            <li className="lv2-count lv2-count--rebuilt">
              <b data-derived="1">{change.counts.rebuilt.toLocaleString("en-US")}</b>
              <span className="lv2-meta">{copy.recompile.countLabels.rebuilt}</span>
            </li>
            <li className="lv2-count lv2-count--added">
              <b data-derived="1">{change.counts.added.toLocaleString("en-US")}</b>
              <span className="lv2-meta">{copy.recompile.countLabels.added}</span>
            </li>
            <li className="lv2-count lv2-count--removed">
              <b data-derived="1">{change.counts.removed.toLocaleString("en-US")}</b>
              <span className="lv2-meta">{copy.recompile.countLabels.removed}</span>
            </li>
            <li className="lv2-count lv2-count--untouched">
              <b data-derived="1">{change.counts.untouched.toLocaleString("en-US")}</b>
              <span className="lv2-meta">{copy.recompile.countLabels.untouched}</span>
            </li>
          </ul>
        </div>

        {/* 11.5-14s Use: a prepared question, answered out of the source it cites. */}
        <div className="lv2-ask lv2-panel">
          <p className="lv2-ask-q">{ask.question}</p>
          <p className="lv2-ask-cite lv2-meta" data-derived="1">
            ↳ {ask.citation.form} · p.{ask.citation.page}
          </p>
        </div>
      </div>

      {/*
        The eight beats as text, stacked, one visible at a time while the loop runs. Under reduced
        motion the stylesheet lays the same eight out as a static list, which is the complete
        state a reader who is not being shown the movement is owed.
      */}
      <div className="lv2-demo-foot">
        <ol className="lv2-demo-captions">
        {beats.map((beat, index) => (
          <li key={beat} className={`lv2-demo-caption lv2-small lv2-cap-${index + 1}`}>
            {beat}
          </li>
        ))}
        </ol>

        <button
          type="button"
          className="lv2-demo-control"
          aria-pressed={!playing}
          onClick={() => setPlaying((was) => !was)}
        >
          <span aria-hidden="true" className="lv2-demo-control-glyph" />
          {playing ? hero.pauseLabel : hero.playLabel}
        </button>
      </div>
    </div>
  );
}
