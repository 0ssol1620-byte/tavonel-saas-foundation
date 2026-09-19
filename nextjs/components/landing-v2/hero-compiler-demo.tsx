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

  RECOMPOSED AGAIN 2026-09-19 (campaign lead, F1-F5). WHAT CHANGED AND WHY.

  The previous composition put four of the six objects inside a ROTATING SLOT: one panel was
  legible at a time and the rest sat at opacity 0 in the same grid cell. Three costs followed, and
  all three were measured rather than argued.

    1. THE FIRST FRAME WAS MOSTLY EMPTY. At t=0 the fold showed the region strip, a 165px
       thumbnail and about 450px of bare ground under it before the play control. A visitor who
       does not wait four seconds saw a page with a picture on it and no product.
    2. THE SLOT RESERVED THE TALLEST BEAT. Five panels sharing one cell make the cell as tall as
       the tallest of them (469px at 1440), so the hero paid for the Structure beat for the whole
       sixteen seconds and showed it for three.
    3. THE RESTING STACK AND THE BEATS SAID THE SAME THINGS TWICE, which is why the objects were
       hidden from the resting stack at >=1200 -- and that hiding is what broke
       `e2e/landing-v2.spec.ts:553`. A spec asserting "the first relation row is visible" was
       right; the composition that hid it was the defect (F1).

  SO THERE IS NO SLOT. Every object has its own grid cell and is on screen from the first frame:

    row 1   READ      the committed REGION CROP across the full width of the stage, big enough
                      that the filing's own sentences can be read, outlined as the region it is
    row 2   LOCATOR   the whole page as a thumbnail with that same box drawn on it, one line of
                      mono metadata under it, and an Evidence Line up to the strip
            CLAIM     the compiled passage, with an Evidence Line down into it from the strip
            NODES     the objects the compiler bound to that region, with their caveat
    row 3   ARRIVALS  the snapshot step and the four filings that arrived
            COUNTS    the comparison between the two complete compiles, with its qualifier

  The sequence no longer decides WHAT is on screen. It decides what is EMPHASISED: every object
  rests at reduced emphasis and its beat brings it to full, where it stays for the rest of the
  loop -- so the two-second hold is the whole hero at full strength, and a frame a screenshot
  catches is never missing a panel. Nothing on this stage starts at opacity 0 except the rotating
  caption sentences, which are one line of narration in one box and cannot be additive.

  The Use beat and its answer panel are gone with the slot. F2 enumerates the hero's objects and
  the answer is not among them; §12's Scene 02 below is three real questions with their real
  citations, at a size where the passage can be read, and repeating a fourth in a 245px column
  bought nothing the fold did not already have. The narration is seven beats now, not eight.

  WHY THE SEQUENCE IS CSS AND NOT JAVASCRIPT
  The first frame has to be the server's, and the loop has to run before this file has hydrated
  (§27). So every beat is a keyframe animation on a shared 16-second timeline -- 14 seconds of
  beats and a 2-second hold -- and each element's own keyframes carry its window as percentages of
  that timeline. No delays, no stagger arithmetic, no scheduler.

  The direction of every animation is the same, and it is the opposite of the obvious one. An
  element's *base* CSS is its finished state, and the keyframes take it back to reduced emphasis
  and return it. That is what makes reduced motion correct rather than approximately correct:
  `app/landing-v2.css` collapses every animation here to 1ms and a single iteration, and a
  finished CSS animation with the default `animation-fill-mode` reverts the element to its base
  style. With no slot left there is no element whose base is hidden, so the reduced-motion state
  IS the hold state and needs no second stack standing in for it (F5).

  WHAT THIS FILE IS FOR
  Four things: the 44px play/pause control, the reduced-motion default, an IntersectionObserver
  that stops the loop when the hero is not on screen (§23: a loop that keeps cycling out of view
  is battery with no reader), and a JavaScript half of the §4.1 signature interaction for engines
  without `:has()`. The signature itself is CSS first, and the fallback writes an attribute
  straight onto the node rather than going through React state -- a hover that re-renders the hero
  is an INP cost for a decoration, and §27's budget is 160ms.

  Below 768 there is no sequence at all (F4): the stylesheet binds no animation there and hides
  the control-and-caption row, so the phone gets the composed state and nothing else. The observer
  is not created there either -- there is nothing for it to pause.

  Every figure on the stage comes from `buildHeroScene()` and is marked `data-derived="1"`, which
  is what `e2e/landing-v2.spec.ts` walks: a digit in this hero that has no receipt fails there.
*/

/** The width at or above which the stylesheet runs the sequence (F4). One number, stated once. */
const SEQUENCE_QUERY = "(min-width: 768px)";

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
  /* The whole record, not only the hero's: the comparison prints the counts with the nouns the
     Recompile scene owns, and one spelling of "untouched" on the page is the point. */
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
  const countsId = useId();
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
      reader has scrolled past the hero the sequence keeps cycling for the rest of the page.
      `data-offscreen` pauses it through the same `animation-play-state` rule the control and the
      hover already use, so there is one mechanism and no state to get out of step.

      F4: BELOW 768 THERE IS NO SEQUENCE, SO THERE IS NO OBSERVER. The stylesheet binds no
      animation at phone widths; an observer there would be a scroll-time callback whose only
      effect is to write an attribute nothing reads.

      THREE ROUNDS OF THE THRESHOLD WERE WRONG, AND ALL THREE FOR ONE REASON: each tried to
      express "is being read" as a fraction, and this demo is not shaped like a viewport. A
      `threshold: 0.25` is only reachable while the observed node is SMALLER than the viewport; a
      symmetric `-25%` band asks a tall demo to reach the middle half of the screen; an asymmetric
      band fails on the element's POSITION rather than its height. So the rule is not a fraction:
      any pixel on screen is being read, no pixel on screen is not, and `threshold: 0` with no
      inset is exactly that sentence at any width, height or position.

      Written straight onto the node, not into React state, for the same reason the signature
      fallback is: re-rendering the hero on a scroll is an INP cost for something no reader sees.
    */
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    if (!window.matchMedia(SEQUENCE_QUERY).matches) return;
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

  const { source, region, compiled, related, change } = scene;
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
  /* Seven, in storyboard order. The eighth (Use) left with the answer panel -- see the header. */
  const beats = [
    hero.beats.source,
    hero.beats.read,
    hero.beats.compile,
    hero.beats.structure,
    hero.beats.verify,
    hero.beats.change,
    hero.beats.recompile,
  ];

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
          READ. The region the compiler read, at the size its own words are readable.
          §4.1's coordinate label sits at the strip's corner and reads on the Verify beat and on
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

          The Evidence Line reaches from the strip above all the way ONTO the box (§4.1): it used
          to be an 18px tick in the gap, which connected two things without touching either. Where
          the box is on the page is read off the same `bbox1000` the outline is drawn from, so the
          two cannot drift -- `--lv2-region-midx` is the box's horizontal centre and
          `--lv2-region-top` its top edge, both as fractions of the page, and `--lv2-page-ar`
          turns the rendered page width into a rendered page height.
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

        {/* CLAIM. The line draws from the strip, and the card is what was compiled out of it. */}
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
          NODES. The objects the compiler bound to this region, as chips.

          `lib/landing-v2-hero.ts` chose them by a binding a reader can check against the strip
          above: the object's own label is written, verbatim, in the passage on the card.

          The caveat that makes an Entity chip honest is PRINTED, not only carried as a `title`. A
          title does not appear on touch, does not appear in a screenshot, is not focus-reachable
          and is announced inconsistently -- and this site already removed that pattern once for a
          weaker claim (BQ-058, in `components/public-site-chrome.tsx`). F3 makes it one sentence
          rather than /explore's 45-word paragraph: the same two facts, at the size this column
          has. It carries no figure now, so it needs no `data-derived` wrapper -- the figure stayed
          on /explore, beside its receipt.
        */}
        <div className="lv2-nodes">
          <ul className="lv2-nodes-list" aria-labelledby={objectsId}>
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
          <p className="lv2-nodes-note lv2-meta" id={objectsId}>
            {extra.boundObjectsCaption}
          </p>
          {related.some((node) => node.kind === "Entity") ? (
            <p className="lv2-nodes-caveat lv2-small">{extra.entityDisclaimer}</p>
          ) : null}
        </div>

        {/* ARRIVALS. They arrived; nothing was revised (contract rule 7). */}
        <RevisionBadge
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
          arrivalsLabel={copy.recompile.arrivalsLabel}
          arrivals={change.arrivals}
        />

        {/*
          COUNTS. The comparison, printed as what it is (contract rule 4, BA-034).

          Three figures and not four: `removed` is zero in this corpus and a zero with a state word
          under it reads as a result rather than as an absence, so it is printed only when there is
          something to print. Each figure carries the noun that says what it counts, the qualifier
          under them names the engine that produced them -- BA-034 requires that label at every
          point the figure is published -- and the note under that names the method.

          Once, not twice. It used to be rendered both inside the rotating slot and in that slot's
          resting stack, because an element cannot be in two layouts; with the slot gone it is one
          element in one cell.
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
            What the partition IS, printed where the partition is read.

            rebuilt / added / untouched is the natural shape of a selective rebuild, which
            `lib/claim-state.ts` records as Direction rather than as a shipped capability of this
            deployment (contract rule 7). The qualifier above names the engine that emitted the
            figures; this names the method, which is the half a reader of the hero alone was
            otherwise left to infer. It is `copy.recompile.contractNote` -- Scene 05's own
            sentence, not a shortened second spelling of it (contract rule 5).
          */}
          <p className="lv2-counts-contract lv2-meta">{copy.recompile.contractNote}</p>
        </div>
      </div>

      {/*
        The seven beats as text, in one slot, one visible at a time while the loop runs.

        The windows are sequential with a gap: each caption reaches zero before the next one
        begins to rise, so two sentences are never legible at once. Under reduced motion the
        stylesheet leaves the LAST one standing (F5), which is the beat that describes the
        composed hero -- and with every object now on screen at full strength, a transcript of the
        other six is six sentences about a picture the reader is already looking at. Below 768 the
        whole row is hidden with the sequence it narrates (F4).
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
