"use client";

/*
  The Explore stage: one interactive world in three acts.

  Landing is a film you watch; this is the same world with the camera handed over (§16). So the
  page is the stage -- a header, the acts, an Ask command and one end CTA -- rather than a hero
  with an instrument panel some way down it. Everything the old page showed at once (digest,
  bbox, type filters, lens tabs, relevance decimals, the entity disclaimer) is either gone or in
  the technical drawer, which is what §48 and §49 ask for.

  State machine, §4.2: ENTRY → WORLD → OBJECT_FOCUS → EVIDENCE → CHANGE_COMPARE → ASK. The state
  is on the stage root as `data-world-act`, together with `data-visual-world="explore"` and the
  view-transition name that lets the landing's last frame morph into this one. OBJECT_FOCUS is a
  real state, not a transition: on a wide stage an object opens beside its source in one step,
  and on a narrow one the object is a step of its own before the source arrives.

  Deep links are read from `window.location` after mount rather than from `searchParams`. Taking
  the query as a server prop would make this route dynamic, and a page whose whole performance
  argument is that it ships no film and no PDF reader should not also give up being static for
  three optional link targets.
*/

import Link from "next/link";
import type { Route } from "next";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import Logomark from "@/components/logomark";
import { trackFunnel, trackFunnelOnce } from "@/lib/funnel-events";


import WorldAct from "./world-act";
import EvidenceWorkbench from "./evidence-workbench";
import EvidenceAct from "./evidence-act";
import ChangeAct from "./change-act";
import AskOverlay from "./ask-overlay";
import type { TechnicalSelection } from "./technical-details";
import styles from "./explore-stage.module.css";
import { useNarrowStage, useReducedMotion } from "@/components/world-visual/use-stage-media";
import { ACCESS_CTA, PRIMARY_NAV } from "@/lib/site-navigation";
import {
  EXPLORE_ACTS,
  EXPLORE_COPY,
  actFromQuery,
  evidenceIdFromQuery,
  type ExploreAct,
  type ExploreAnswerView,
  type ExploreChangeView,
  type ExploreTechnicalRecord,
} from "@/lib/explore-story";
import type { VisualLayout, VisualState, VisualWorldModel } from "@/lib/visual-world-model";

const TechnicalDetails = dynamic(() => import("./technical-details"), { ssr: false });

/*
  G1-021. The three destinations a visitor who landed here from a search actually needs.

  Read from `PRIMARY_NAV` and `ACCESS_CTA` rather than typed, so the labels are the site's own and
  a rename reaches this header too. Three, not the whole bar: the stage replaces the site chrome
  on purpose, and reproducing eight links over it would undo what the stage is for.
*/
const EXIT_LINKS = [
  ...PRIMARY_NAV.filter((link) => link.href === "/product" || link.href === "/pricing"),
  ACCESS_CTA,
];

type Props = {
  model: VisualWorldModel;
  layout: VisualLayout;
  change: ExploreChangeView;
  answers: ExploreAnswerView[];
  technical: ExploreTechnicalRecord;
  /*
    WG-034, as a prop rather than a constant: the day the sample's sources were captured, read in
    `app/explore/page.tsx` off the acquisition manifest the fetch script wrote.
  */
  capturedOn: string;
};

export default function ExploreStage({ model, layout, change, answers, technical, capturedOn }: Props) {
  const reduced = useReducedMotion();
  const narrow = useNarrowStage();

  const opening = useMemo(() => {
    const claim = model.focus.find((id) => model.nodes.find((node) => node.id === id)?.kind === "Claim");
    return claim ?? model.focus[0] ?? model.nodes[0].id;
  }, [model]);

  const [act, setAct] = useState<ExploreAct>("entry");
  const [settled, setSettled] = useState(false);
  /*
    The graph enters unselected. The opening id only seeds the evidence fallback so a direct
    Evidence deep-link has a real region to show; it must not pre-activate a World node before
    the reader clicks one. Otherwise the stage says DIRECTLY CONNECTED on first entry and the
    intended click-to-focus interaction has already happened invisibly.
  */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [evidenceId, setEvidenceId] = useState(() => {
    const node = model.nodes.find((item) => item.id === opening);
    return node?.evidenceRefs[0] ?? model.evidence[0]?.id ?? "";
  });
  /*
    An `evidence` link that names a region this model cannot open. That is not the same as no
    `evidence` parameter: an absent one lets `act` decide, but an explicit ID that does not resolve
    must not be filled with the seeded fallback or a page-mate, because that shows a reader a
    passage they did not ask for as if it were the one they did. The Evidence act says so instead,
    and this clears when the URL is restored to something valid or the reader moves on.

    Foundation 424: a flag, not the ID. The query string is untrusted input, so the stage never
    echoes it back onto the page; the unavailable state is the same generic copy for every link.
  */
  const [evidenceUnavailable, setEvidenceUnavailable] = useState(false);
  const [askIndex, setAskIndex] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const returnAct = useRef<ExploreAct>("world");

  const enter = useCallback((next: ExploreAct) => {
    // Every act change goes through here -- the rail, the entry CTA, the deep link and the
    // openers -- so the change act is counted once rather than once per way in.
    if (next === "change_compare") trackFunnel("explore_change_opened");
    const url = new URL(window.location.href);
    if (next === "entry") url.searchParams.delete("act");
    else url.searchParams.set("act", next);
    url.searchParams.delete("evidence");
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    setEvidenceUnavailable(false);
    setAct(next);
    setSettled(true);
  }, []);

  const selectNode = useCallback(
    (id: string) => {
      setSelectedId(id);
      const node = model.nodes.find((item) => item.id === id);
      // The kind, never the id. Which object a reader opened is the reader's business.
      if (node) trackFunnel("explore_object_selected", { kind: node.kind });
      const first = node?.evidenceRefs[0];
      if (first) setEvidenceId(first);
    },
    [model.nodes],
  );

  const openNode = useCallback(
    (id: string) => {
      selectNode(id);
      trackFunnel("explore_evidence_opened", { from: "object" });
      enter(narrow ? "object_focus" : "evidence");
    },
    [enter, narrow, selectNode],
  );

  // The object a region is opened under: a Claim that holds it if one shipped, else any holder.
  const ownerOf = useCallback(
    (regionId: string) =>
      model.nodes.find((node) => node.kind === "Claim" && node.evidenceRefs.includes(regionId)) ??
      model.nodes.find((node) => node.evidenceRefs.includes(regionId)),
    [model.nodes],
  );

  const openRegion = useCallback(
    (regionId: string) => {
      const owner = ownerOf(regionId);
      if (owner) setSelectedId(owner.id);
      setEvidenceId(regionId);
      trackFunnel("explore_evidence_opened", { from: "region" });
      enter("evidence");
      const url = new URL(window.location.href);
      url.searchParams.set("evidence", regionId);
      window.history.replaceState(null, "", url);
    },
    [enter, ownerOf],
  );

  // Reading a URL must not call the click openers: their pushState would discard the browser's
  // forward entries when an evidence page is re-mounted after Back. Use the same restoration
  // for initial links and popstate; only an explicit user action creates a history entry.
  const restoreFromUrl = useCallback(() => {
    const query = new URLSearchParams(window.location.search);
    const asked = query.get("evidence");
    const found = evidenceIdFromQuery(asked ?? undefined, model.evidence);
    /*
      Only the region the link names counts as resolved; any other answer would be a substitute.
      And the exact region is not enough on its own: it resolves only together with a retained
      owner that holds it, so the source sheet never opens under an object it does not belong to.
      Either half missing is the unavailable state, not a nearby passage.
    */
    const owner = asked !== null && found === asked ? ownerOf(found) : undefined;
    const region = owner ? found ?? undefined : undefined;
    const requested: ExploreAct = asked !== null ? "evidence" : actFromQuery(query.get("act") ?? undefined);
    if (region && owner) {
      setSelectedId(owner.id);
      setEvidenceId(region);
    } else if (asked !== null) {
      setSelectedId(null);
    }
    setEvidenceUnavailable(asked !== null && !region);
    setAct(requested);
    setSettled(true);
    return { requested, region };
  }, [model.evidence, ownerOf]);

  useEffect(() => {
    const { requested, region } = restoreFromUrl();
    trackFunnel("explore_entered", { act: requested });
    if (region) trackFunnel("explore_evidence_opened", { from: "region" });
    if (requested === "change_compare") trackFunnel("explore_change_opened");
  }, [restoreFromUrl]);

  useEffect(() => {
    const restore = () => { restoreFromUrl(); };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [restoreFromUrl]);

  useEffect(() => {
    /*
      D7 `world_explore_60s`: a minute actually spent reading this World.

      §30 wants a signal that a reader engaged with the sample rather than glanced at it, and
      `explore_entered` (which D7 keeps as `world_explore_start`) cannot tell those apart. A
      plain 60-second timeout would count the minute a background tab spends on a laptop that
      went to sleep, so what is counted is VISIBLE time: the timer stops when the document is
      hidden, keeps what it had already earned, and resumes when the tab comes back. It fires
      once per page session, which is `trackFunnelOnce`'s own scope, and carries no detail at
      all -- not which act was open, not which question was asked.
    */
    let remaining = 60_000;
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (timer !== undefined || remaining <= 0) return;
      startedAt = Date.now();
      timer = setTimeout(() => {
        timer = undefined;
        remaining = 0;
        trackFunnelOnce("world_explore_60s");
      }, remaining);
    };
    const stop = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining -= Date.now() - startedAt;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const closeAsk = useCallback(() => setAct(returnAct.current), []);

  const openAsk = useCallback(() => {
    trackFunnel("explore_ask_used");
    setAct((current) => {
      if (current === "ask") return current;
      returnAct.current = current === "entry" ? "world" : current;
      return "ask";
    });
    setSettled(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && act !== "entry" && act !== "ask") {
        const target = event.target as HTMLElement | null;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
        event.preventDefault();
        openAsk();
        return;
      }
      if (event.key !== "Escape") return;
      if (drawerOpen) {
        setDrawerOpen(false);
        return;
      }
      setAct((current) => {
        if (current === "ask") return returnAct.current;
        if (current === "evidence") return narrow ? "object_focus" : "world";
        if (current === "object_focus") return "world";
        return current;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, drawerOpen, narrow, openAsk]);

  /*
    Colour appears in exactly one act.

    Every object in this World is a candidate, so the World and Evidence acts are drawn without
    state colour -- there is no state to report. The Change act is the one place a real state
    difference exists, so it is the one place the palette is used: amber on objects named by the
    diff, dimmed only when an object retains the same compiled identity across both Worlds. A
    filing comparison may legitimately have no dimmed objects.
  */
  const worldStates = useMemo<Record<string, VisualState>>(() => ({}), []);
  const changeStates = useMemo<Record<string, VisualState>>(() => {
    const affected = new Set(change.affectedNodeIds);
    return Object.fromEntries(
      layout.placements.map((placement) => [
        placement.id,
        affected.has(placement.id) ? ("affected" as VisualState) : ("dim" as VisualState),
      ]),
    );
  }, [change.affectedNodeIds, layout.placements]);

  /*
    Which act is drawn, as opposed to which state the stage is in.

    ENTRY draws the world behind its own scrim and ASK draws whatever it was opened over, so
    two of the six states have no composition of their own. The rail collapses one step
    further: OBJECT_FOCUS and EVIDENCE are the two halves of one act on a wide screen and two
    steps of it on a narrow one, and both light the same rail entry.
  */
  const scene = act === "entry" ? "world" : act === "ask" ? returnAct.current : act;
  const railAct: ExploreAct = scene === "object_focus" ? "evidence" : scene;
  const selectedNode = model.nodes.find((node) => node.id === selectedId) ?? model.nodes[0];
  const activeRegion =
    evidenceUnavailable ? null : model.evidence.find((item) => item.id === evidenceId) ?? null;

  const selection: TechnicalSelection = {
    objectId: selectedNode.id,
    objectKind: selectedNode.kind,
    evidenceId: activeRegion?.id ?? null,
    sourceVersionId: activeRegion?.sourceVersionId ?? null,
    bbox1000: activeRegion?.bbox1000 ?? null,
    digest: activeRegion?.digest ?? null,
    authority: activeRegion?.authority ?? null,
  };

  return (
    <main id="main" className={`${styles.page} paper-product`}>
      <header className={styles.header}>
        {/*
          chrome-01. One wordmark everywhere. The header, the footer and the share card set
          TAVONEL in the mono lockup; here it was a bare `<b>` inheriting this header's 12px
          sans, which made /explore the one page where the brand mark is a different typeface.
          `.wordmark` is the global lockup and carries the face; `.brand` keeps the stage's own
          colour and its 44px target.
        */}
        <Link href="/" className={`wordmark ${styles.brand}`}>
          <Logomark size={20} />
          <b>TAVONEL</b>
        </Link>
        <p className={styles.crumb}>
          <span>WORLD</span>
          <span className={styles.badge}>{EXPLORE_COPY.badge}</span>
        </p>
        {/*
          BA-029. Two bordered boxes of the same weight are not a hierarchy, and an unlabelled X
          on a page a visitor arrives at from a marketing CTA is a dead end: the logomark was the
          only way back and nothing said so. So the drawer opener is a quiet text button and the
          exit names its destination rather than drawing a glyph.
        */}
        {/*
          G1-021. This page replaces the site header, and a visitor who arrives here from a search
          had TECHNICAL DETAILS and one link home -- no way to Product, Pricing or Contact without
          going back to the top and starting again. Three links, not a menu: the stage is the page,
          and reproducing the whole navigation over it would undo what the stage is for.
        */}
        <div className={styles.headerActions}>
          <nav className={styles.siteLinks} aria-label="TAVONEL">
            {EXIT_LINKS.map((link) => (
              <Link key={link.href} href={link.href as Route}>{link.label}</Link>
            ))}
          </nav>
          <button
            type="button"
            className={styles.technicalButton}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            {EXPLORE_COPY.technical}
          </button>
          <Link href="/" className={styles.close}>
            <span aria-hidden="true">←</span> {EXPLORE_COPY.closeLabel}
          </Link>
        </div>
      </header>

      <section
        className={styles.stage}
        data-visual-world="explore"
        data-world-act={act}
        data-narrow={narrow ? "1" : "0"}
        style={{ viewTransitionName: "world-canvas" }}
        aria-label="Compiled World sample"
      >
        {act === "entry" ? null : (
          <div className={styles.railRow}>
            <nav className={styles.rail} aria-label="Acts">
              <button type="button" onClick={() => enter("entry")}>Content &amp; evidence</button>
              {EXPLORE_ACTS.map((entry) => (
                <button
                  key={entry.act}
                  type="button"
                  aria-current={entry.act === railAct ? "step" : undefined}
                  onClick={() => enter(entry.act === "evidence" && narrow ? "object_focus" : entry.act)}
                >
                  {entry.label}
                </button>
              ))}
            </nav>
            <p className={styles.actCaption}>
              {EXPLORE_ACTS.find((entry) => entry.act === railAct)?.caption}
            </p>
          </div>
        )}

        <div className={styles.acts} hidden={act === "entry"}>
          {scene === "world" && act !== "entry" ? (
            <WorldAct
              model={model}
              layout={layout}
              states={worldStates}
              selectedId={selectedId}
              onSelect={selectNode}
              onOpen={openNode}
              reduced={reduced}
              settled={settled}
            />
          ) : null}

          {/*
            Foundation 424. Generic copy: the requested ID is never rendered. The recovery action
            reuses `.paneBack` -- the Evidence act's own back control, with its 44px minimum target
            -- and returns through `enter("entry")`, the same sample navigation the rail uses, which
            also clears the unavailable flag.
          */}
          {(scene === "object_focus" || scene === "evidence") && evidenceUnavailable ? (
            <div role="alert" data-evidence-unavailable="1">
              <h2>This passage is not available here</h2>
              <p>
                The link names a source region this sample cannot open. No other passage is shown in
                its place.
              </p>
              <button type="button" className={styles.paneBack} onClick={() => enter("entry")}>
                Browse the evidence in this sample
              </button>
            </div>
          ) : scene === "object_focus" || scene === "evidence" ? (
            <EvidenceAct
              model={model}
              selectedId={selectedNode.id}
              evidenceId={evidenceId}
              onSelectRegion={setEvidenceId}
              onSelectObject={selectNode}
              onOpenSource={() => enter("evidence")}
              onBack={() => enter(scene === "evidence" && narrow ? "object_focus" : "world")}
              step={scene}
            />
          ) : null}

          {scene === "change_compare" ? (
            <ChangeAct
              model={model}
              layout={layout}
              states={changeStates}
              change={change}
              selectedId={selectedId}
              onSelect={selectNode}
              onOpen={selectNode}
              reduced={reduced}
              settled={settled}
            />
          ) : null}
        </div>

        {act === "entry" ? <EvidenceWorkbench model={model} answers={answers} technical={technical} capturedOn={capturedOn} onOpenRegion={openRegion} onRelations={() => enter("world")} onChanges={() => enter("change_compare")} /> : null}

        {act === "ask" ? (
          <AskOverlay
            answers={answers}
            index={askIndex}
            onSelectQuestion={setAskIndex}
            onOpenRegion={openRegion}
            onClose={closeAsk}
          />
        ) : null}

        {act === "entry" ? null : (
          <button type="button" className={styles.askBar} onClick={openAsk} aria-expanded={act === "ask"}>
            <Search size={14} aria-hidden="true" />
            <span>{EXPLORE_COPY.askPlaceholder}</span>
            <kbd>/</kbd>
          </button>
        )}
      </section>

      {drawerOpen ? (
        <TechnicalDetails
          record={technical}
          selection={selection}
          change={change}
          answer={act === "ask" ? answers[askIndex] ?? null : null}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}

      <section className={styles.next}>
        <p>{EXPLORE_COPY.endSourcesLabel}</p>
        <h2>{EXPLORE_COPY.endHeading}</h2>
        {/*
          BA-029. The closing section was a two-column grid with the whole left column empty below
          the heading, which reads as a layout failure rather than as restraint. What belongs there
          is the thing a reader who has just walked the sample wants named: the filings it was
          compiled from. Every line is read off `technical.documents`, which is the acquisition
          record -- form, filing date and the bytes the compiler read -- so this cannot drift from
          the World above it.
        */}
        <ul className={styles.nextSources} aria-label="The filings this sample is compiled from">
          {technical.documents.map((document) => (
            <li key={document.documentId}>
              <b>{document.form}</b> filed {document.filingDate} ·{" "}
              {document.compiledPageCount === document.pageCount
                ? `${document.pageCount} pages`
                : `${document.compiledPageCount} of ${document.pageCount} pages`}
              {/*
                G1-023. Two of the five read "36 of 37" and "38 of 40" with no reason beside them,
                which reads as a compile that gave up rather than as what it is. Every page of every
                filing went to the compiler -- `sliceRationale` says so -- and `compiledPageCount`
                counts the pages a region was actually read out of, so the shortfall is pages that
                produced no region. Nothing in the World stands on them, and the sentence is derived
                from that definition rather than written per document.
              */}
              {document.compiledPageCount !== undefined && document.compiledPageCount < document.pageCount ? (
                <small className={styles.nextSourceNote}>
                  {document.pageCount - document.compiledPageCount === 1
                    ? "1 page carries no region, so nothing in this World stands on it."
                    : `${document.pageCount - document.compiledPageCount} pages carry no region, so nothing in this World stands on them.`}
                  {" "}
                  <Link href={"/explore?act=evidence" as Route}>See what a region is</Link>.
                </small>
              ) : null}
            </li>
          ))}
        </ul>
        {/*
          BA-036. Three buttons in one row is the rule 3.4 bars, and the third was the one nobody
          needed as a button: a reader who has finished the sample either brings their own files or
          connects a system. The guide stays one click away as a sentence. Only the sign-in exit is
          the signup step -- counting the other action as a conversion would inflate the last
          funnel row.
        */}
        <div>
          {EXPLORE_COPY.endActions.map((action) => (
            <Link
              key={action.href}
              href={action.href as Route}
              data-primary={action.primary ? "1" : "0"}
              onClick={action.href === "/login" ? () => trackFunnel("explore_to_signup") : undefined}
            >
              {action.label}
            </Link>
          ))}
        </div>
        <p className={styles.nextNote}>
          Or read how a compile reaches a World first, in the{" "}
          <Link href="/knowledge-compiler">Knowledge Compiler guide</Link>.
        </p>
      </section>
    </main>
  );
}
