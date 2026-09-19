"use client";

import { useEffect, useId, useRef, useState } from "react";
import CompiledClaim from "./compiled-claim";
import EntityNode from "./entity-node";
import EvidenceLine from "./evidence-line";
import RevisionBadge from "./revision-badge";
import SourcePage, { SourceStrip } from "./source-page";
import type { LandingV2Copy } from "@/lib/landing-v2-copy";
import type { HeroScene } from "@/lib/landing-v2-hero";
import type { LandingV2HeroExtraCopy } from "@/lib/landing-v2-hero-copy";

/*
  The hero demo (blueprint §11, §22, §43; contract D11): DOM and CSS, no canvas, no video, no SVG.

  RECOMPOSED 2026-09-19. WHAT CHANGED AND WHY.
  The first composition stacked seven panels down the right-hand column -- a full portrait page
  render, the claim, the objects, the revision step, four counts and an answer -- and the hero
  measured 1,308px at 1440x900 (145vh) and 2,273px at 1024. The compiled claim, which is the
  entire point of the key visual, sat below the fold at every desktop width, and the page region
  the whole argument rests on was rendered at about six pixels a glyph. §43's key visual is
  "original document <-> Evidence Line <-> compiled knowledge"; none of the three was legible in
  one screen.

  So the stage is now three blocks and one rotating slot, and it fits a viewport:

    READ      the committed REGION CROP across the full width of the stage, big enough that the
              filing's own sentences can be read, outlined as the region it is (§22: crop to the
              level where the content is understood)
    LOCATOR   the whole page as a small thumbnail with that same box drawn on it, one line of
              mono metadata under it, and an Evidence Line up to the strip -- "this strip is that
              box"
    CLAIM     the compiled passage, with an Evidence Line down into it from the strip
    SLOT      Structure, Change, Recompile and Use in sequence in ONE box, over a static stack
              that is what a reader sees when nothing is moving

  WHY THE SEQUENCE IS CSS AND NOT JAVASCRIPT
  The first frame has to be the server's, and the loop has to run before this file has hydrated
  (§27). So every beat is a keyframe animation on a shared 16-second timeline -- 14 seconds of
  beats and a 2-second hold, exactly the storyboard's -- and each element's own keyframes carry
  its window as percentages of that timeline. No delays, no stagger arithmetic, no scheduler.

  The direction of every animation is the same, and it is the opposite of the obvious one. An
  element's *base* CSS is its finished state, and the keyframes hide it and bring it back. That is
  what makes reduced motion correct rather than approximately correct: `app/landing-v2.css`
  collapses every animation here to 1ms and a single iteration, and a finished CSS animation with
  the default `animation-fill-mode` reverts the element to its base style. The rotating slot is
  the one place that rule needs a second element rather than a cleverer keyframe: four beats
  cannot share one resting frame, so the slot holds a static stack whose base is visible and four
  beat panels whose base is not. Under reduced motion the stack is what remains -- the badge line,
  the counts with their qualifier, and the objects bound to the region -- which is the complete
  state §26 asks for, with nothing overlapping.

  WHAT THIS FILE IS FOR
  Four things: the 44px play/pause control, the reduced-motion default, an IntersectionObserver
  that stops the loop when the hero is not on screen (§23: a loop that keeps cycling out of view
  is battery with no reader), and a JavaScript half of the §4.1 signature interaction for engines
  without `:has()`. The signature itself is CSS first, and the fallback writes an attribute
  straight onto the node rather than going through React state -- a hover that re-renders the hero
  is an INP cost for a decoration, and §27's budget is 160ms.

  Every figure on the stage comes from `buildHeroScene()` and is marked `data-derived="1"`, which
  is what `e2e/landing-v2.spec.ts` walks: a digit in this hero that has no receipt fails there.
*/

/**
 * Put the record's figures into a line the copy deck owns.
 *
 * The hero's metadata is half copy and half measurement, and the halves come from different
 * modules on purpose: the copy modules may not contain a digit, and `lib/landing-v2-hero.ts` has
 * no locale. So the copy carries `p.{page} of {pageCount}` in one language and
 * `{pageCount}쪽 중 {page}쪽` in the other, and the numbers arrive here. An unknown placeholder is
 * left standing rather than blanked, so a missing key shows up in a screenshot instead of quietly
 * printing a sentence with a hole in it.
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
  extra,
  stateLabel,
  pageLabel,
  pageAlt,
  sizes,
}: {
  scene: HeroScene;
  /* The whole record, not only the hero's: the Recompile beat prints the counts with the nouns
     the Recompile scene owns, and one spelling of "untouched" on the page is the point. */
  copy: LandingV2Copy;
  /** The strings the recomposition needed that the campaign's copy deck does not carry. */
  extra: LandingV2HeroExtraCopy;
  /** The World's own word for the compiled object's state, resolved on the server. */
  stateLabel: string;
  /** `sourcePageQualifier(representationKind, korean)` -- "original PDF" or "reference render". */
  pageLabel: string;
  pageAlt: string;
  /** The same string `app/page.tsx` puts on the preload; one source, so they cannot disagree. */
  sizes: string;
}) {
  const [playing, setPlaying] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const staticCountsId = useId();
  const beatCountsId = useId();
  const objectsId = useId();

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
      A loop nobody is watching is not a loop, it is a repaint.

      §23 says the loop must never disturb reading; this is the other half of it -- once the
      reader has scrolled past the hero the sequence keeps cycling for the rest of the page, and
      on a phone that is the whole visit. `data-offscreen` pauses it through the same
      `animation-play-state` rule the control and the hover already use, so there is one mechanism
      and no state to get out of step. The intent is that a hero one pixel into view is not being
      read either.

      THREE ROUNDS OF THIS RULE WERE WRONG, AND ALL THREE FOR ONE REASON: each tried to express
      "is being read" as a fraction, and this demo is not shaped like a viewport.

      ROUND3-P1 wrote it as `{ threshold: 0.25 }` -- "a quarter of it is on screen" -- which is
      only reachable while the observed node is SMALLER than the viewport. The phone composition
      makes `.lv2-demo` 1719px tall against an 844px viewport, so at scroll 0 only 13% of it can
      ever be visible and the sequence froze mid-beat at first paint.

      ROUND3-QA replaced it with a symmetric `-25% 0px -25% 0px` band, which asks the demo to
      reach the middle half of the viewport; on a phone the demo's TOP already sits below it.

      P3-QA-ROUND1: the asymmetric band `0px 0px -25% 0px` failed the same way, and its comment
      claimed to be "genuinely independent of the element's height". It was -- and irrelevantly
      so, because it is not independent of the element's POSITION. That band's bottom edge sits at
      0.75 x the viewport height, so a demo whose TOP is below that line never intersects at any
      height: measured at first paint, the demo top was 669px at 390x844 and 715px at 360x780
      against band bottoms of 633px and 585px. `data-offscreen="1"` was written with no scrolling
      at all, about 175px of the demo was on screen, and the source raster sat at 43% opacity
      under a control that still read "Pause the compile sequence" -- on the surface contract
      rule 12 says the founder checks first.

      So the rule is not a fraction any more. Any pixel on screen is being read; no pixel on
      screen is not. `threshold: 0` with no inset is exactly that sentence, and there is no
      width, height or position at which it can come to mean something else. The loop that keeps
      cycling for a reader who has scrolled past is still stopped, which is all §23 asked for.

      Written straight onto the node, not into React state, for the same reason the signature
      fallback is: re-rendering the hero on a scroll is an INP cost for something no reader sees.
    */
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) node.setAttribute("data-offscreen", entry.isIntersecting ? "0" : "1");
      },
      { threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
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
  const filed = fill(extra.filedFormat, { form: source.form, filingDate: source.filingDate });
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

  /*
    The comparison, printed as what it is (contract rule 4, BA-034).

    Three figures and not four: `removed` is zero in this corpus and a zero with a state word
    under it reads as a result rather than as an absence, so it is printed only when there is
    something to print. Each figure carries the noun that says what it counts, and the qualifier
    under them names the engine that produced them -- BA-034 requires that label at every point
    the figure is published, and this is one of two such points on the landing.

    Rendered twice: once inside the rotating slot as the Recompile beat, once in the slot's
    static stack, which is what a reader sees under reduced motion and through the loop's hold.
    Two instances rather than one moved element, because an element cannot be in two layouts.
  */
  const counts = (id: string) => (
    <div className="lv2-counts">
      <p className="lv2-counts-title lv2-meta" id={id}>
        {copy.recompile.compareLabel}
      </p>
      <ul className="lv2-counts-list" aria-labelledby={id}>
        <li className="lv2-count lv2-count--rebuilt">
          <b data-derived="1">{change.counts.rebuilt.toLocaleString("en-US")}</b>
          <span className="lv2-meta">{copy.recompile.countLabels.rebuilt}</span>
        </li>
        <li className="lv2-count lv2-count--added">
          <b data-derived="1">{change.counts.added.toLocaleString("en-US")}</b>
          <span className="lv2-meta">{copy.recompile.countLabels.added}</span>
        </li>
        {change.counts.removed > 0 ? (
          <li className="lv2-count lv2-count--removed">
            <b data-derived="1">{change.counts.removed.toLocaleString("en-US")}</b>
            <span className="lv2-meta">{copy.recompile.countLabels.removed}</span>
          </li>
        ) : null}
        <li className="lv2-count lv2-count--untouched">
          <b data-derived="1">{change.counts.untouched.toLocaleString("en-US")}</b>
          <span className="lv2-meta">{copy.recompile.countLabels.untouched}</span>
        </li>
      </ul>
      <p className="lv2-counts-note lv2-meta">{extra.countsQualifier}</p>
      {/*
        What the partition IS, printed where the partition is read (QA round 4).

        rebuilt / added / untouched is the natural shape of a selective rebuild, which
        `lib/claim-state.ts` records as Direction rather than as a shipped capability of this
        deployment (contract rule 7). The qualifier above names the engine that emitted
        the figures; this names the method, which is the half a reader of the hero alone was
        otherwise left to infer. It is `copy.recompile.contractNote` -- Scene 05's own sentence,
        not a shortened second spelling of it (contract rule 5).
      */}
      <p className="lv2-counts-contract lv2-meta">{copy.recompile.contractNote}</p>
    </div>
  );

  /*
    The objects the compiler bound to this region, as chips.

    `lib/landing-v2-hero.ts` chose them by a binding a reader can check against the strip above:
    the object's own label is written, verbatim, in the passage on the card.

    ROUND3-P1: the caveat that makes an Entity chip honest used to reach the page ONLY as the
    chip's `title`. A title does not appear on touch, does not appear in a screenshot, is not
    focus-reachable and is announced inconsistently -- and this site already removed that pattern
    once for a weaker claim (BQ-058, in `components/public-site-chrome.tsx`). So the static stack
    prints `EXPLORE_COPY.entityDisclaimer` verbatim -- the sentence /explore publishes, with its
    own figure -- and the title stays as well. `data-derived="1"` because the sentence carries
    that figure, and the figure is the receipt rather than something this lane typed.

    It rides inside `objects()` rather than beside one of the two call sites, because which of
    them a reader actually sees depends on the width: below 1200 `.lv2-slot-static` is
    `display: none` and the Structure beat is the one in flow; at 1200 and up the beat is an
    absolutely positioned overlay and the static stack is what remains at rest, when paused, and
    under reduced motion. The chips themselves are already rendered twice for that reason; the
    caveat travels with them.
  */
  const objects = (id: string) => (
    <div className="lv2-nodes">
      <ul className="lv2-nodes-list" aria-labelledby={id}>
        {related.map((node) => (
          <li key={node.id}>
            <EntityNode
              label={node.label}
              kind={node.kind}
              predicate={node.predicate}
              via={node.via}
              href={scene.links.world}
              title={node.kind === "Entity" ? extra.entityDisclaimer : undefined}
            />
          </li>
        ))}
      </ul>
      <p className="lv2-nodes-note lv2-meta" id={id}>
        {extra.boundObjectsCaption}
      </p>
      {related.some((node) => node.kind === "Entity") ? (
        <p className="lv2-nodes-caveat lv2-small" data-derived="1">
          {extra.entityDisclaimer}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="lv2-demo" ref={root} data-playing={playing ? "1" : "0"} data-signature="0" data-offscreen="0">
      {/*
        D8: the visible demo eyebrow is gone. "THE KNOWLEDGE COMPILER" (x=72) and "WHAT THE
        COMPILER DOES WITH ONE PAGE" (x=700) sat on the same baseline, in the same mono face, the
        same 13px and the same tracking, with the second 2.4x the width of the first -- two
        competing eyebrows in the same optical position, and the reader's eye landed on the wrong
        one. The rotating caption under the control narrates the demo, which is what this label
        was doing badly. It survives as the group's accessible name, where it is still needed and
        where it competes with nothing.
      */}
      <div className="lv2-demo-stage" role="group" aria-label={hero.demoLabel}>
        {/*
          READ (0.0-2.4s). The region the compiler read, at the size its own words are readable.
          §4.1's coordinate label sits at the strip's corner and appears on the Verify beat and on
          hover or focus -- a receipt a reader can call up, not a permanent decoration.
        */}
        <figure className="lv2-read">
          <SourceStrip
            src={region.cropSrc}
            srcSet={region.cropSrcSet}
            sizes={sizes}
            width={region.cropWidth}
            height={region.cropHeight}
            alt={extra.readStripAlt}
            priority
          />
          <figcaption className="lv2-read-label lv2-meta">
            <span data-derived="1">{regionLabel}</span>
            {/* The unit those four numbers are in, in the same language as the label beside it. */}
            <span className="lv2-read-unit"> · {copy.evidence.regionUnit}</span>
          </figcaption>
        </figure>

        {/*
          LOCATOR. Where on the filing that strip is: the whole page, the same box drawn on it,
          and one line of metadata.

          The Evidence Line reaches from the strip above all the way ONTO the box (§4.1, round 3
          design review: it used to be a 18px tick in the gap, which connected two things without
          touching either). Where the box is on the page is read off the same `bbox1000` the
          outline is drawn from, so the two cannot drift: `--lv2-region-midx` is the box's
          horizontal centre and `--lv2-region-top` its top edge, both as fractions of the page,
          and `--lv2-page-ar` turns the rendered page width into a rendered page height.
          A style ATTRIBUTE, never a <style> element (CSP, rule 9).
        */}
        <figure
          className="lv2-locator"
          style={
            {
              "--lv2-region-midx": `${(region.bbox1000[0] + region.bbox1000[2]) / 2000}`,
              "--lv2-region-top": `${region.bbox1000[1] / 1000}`,
              "--lv2-page-ar": `${source.height / source.width}`,
            } as React.CSSProperties
          }
        >
          <EvidenceLine className="lv2-line--locator" />
          <SourcePage
            src={source.rasterSrc}
            srcSet={source.rasterSrcSet}
            sizes="200px"
            width={source.width}
            height={source.height}
            alt={pageAlt}
            bbox1000={region.bbox1000}
          />
          <figcaption className="lv2-locator-meta lv2-meta" data-derived="1" title={source.digest}>
            {filed} · {pageOf} · {pageLabel}
          </figcaption>
        </figure>

        {/* COMPILE (2.4-4.0s). The line draws from the strip, then the claim arrives bound to it. */}
        <div className="lv2-claim-block">
          <EvidenceLine className="lv2-line--claim" />
          <CompiledClaim
            kind={compiled.kind}
            state={compiled.state}
            stateLabel={stateLabel}
            excerpt={compiled.excerpt}
            truncated={compiled.excerptTruncated}
            href={scene.links.evidence}
          />
        </div>

        {/*
          THE ROTATING SLOT. Structure, Change, Recompile and Use in one box, in sequence.

          The static stack is first in the DOM and in flow: it gives the slot its height and it is
          what remains when nothing is animating. The four beats are absolutely positioned over
          it, one visible at a time, so the slot can never overlap anything -- including itself.
        */}
        <div className="lv2-slot">
          <div className="lv2-slot-static">
            <RevisionBadge
              beforeLabel={beforeLabel}
              afterLabel={afterLabel}
              arrivalsLabel={copy.recompile.arrivalsLabel}
              arrivals={[]}
            />
            {counts(staticCountsId)}
            {objects(objectsId)}
          </div>

          {/* 4.0-7.2s Structure, held through the Verify beat the claim's own state dot carries. */}
          <div className="lv2-slot-beat lv2-slot-beat--structure">{objects(`${objectsId}-beat`)}</div>

          {/* 7.2-9.5s Change. They arrived; nothing was revised (contract rule 7). */}
          <div className="lv2-slot-beat lv2-slot-beat--change">
            <RevisionBadge
              beforeLabel={beforeLabel}
              afterLabel={afterLabel}
              arrivalsLabel={copy.recompile.arrivalsLabel}
              arrivals={change.arrivals}
            />
          </div>

          {/* 9.5-11.5s Recompile: the comparison between two complete compiles. */}
          <div className="lv2-slot-beat lv2-slot-beat--recompile">{counts(beatCountsId)}</div>

          {/* 11.5-14s Use: a prepared question, answered out of the region it cites. */}
          <div className="lv2-slot-beat lv2-slot-beat--use">
            <div className="lv2-ask lv2-panel">
              <p className="lv2-ask-q">{ask.question}</p>
              <p className="lv2-ask-cite lv2-meta" data-derived="1">
                {fill(extra.askCitationFormat, { form: ask.citation.form, page: ask.citation.page })}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/*
        The eight beats as text, in one slot, one visible at a time while the loop runs.

        The windows are sequential with a gap: each caption reaches zero before the next one
        begins to rise, so two sentences are never legible at once -- the round-1 defect was a
        shared crossfade in which both were half-visible for a fifth of a second. Under reduced
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
