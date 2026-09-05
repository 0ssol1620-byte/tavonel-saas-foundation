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
import { Search, X } from "lucide-react";
import Logomark from "@/components/logomark";
import WorldAct from "./world-act";
import EvidenceAct from "./evidence-act";
import ChangeAct from "./change-act";
import AskOverlay from "./ask-overlay";
import type { TechnicalSelection } from "./technical-details";
import styles from "./explore-stage.module.css";
import { useNarrowStage, useReducedMotion } from "@/components/world-visual/use-stage-media";
import {
  EXPLORE_ACTS,
  EXPLORE_COPY,
  actFromQuery,
  type ExploreAct,
  type ExploreAnswerView,
  type ExploreChangeView,
  type ExploreTechnicalRecord,
} from "@/lib/explore-story";
import type { VisualLayout, VisualState, VisualWorldModel } from "@/lib/visual-world-model";

const TechnicalDetails = dynamic(() => import("./technical-details"), { ssr: false });

type Props = {
  model: VisualWorldModel;
  layout: VisualLayout;
  change: ExploreChangeView;
  answers: ExploreAnswerView[];
  technical: ExploreTechnicalRecord;
};

export default function ExploreStage({ model, layout, change, answers, technical }: Props) {
  const reduced = useReducedMotion();
  const narrow = useNarrowStage();

  const opening = useMemo(() => {
    const claim = model.focus.find((id) => model.nodes.find((node) => node.id === id)?.kind === "Claim");
    return claim ?? model.focus[0] ?? model.nodes[0].id;
  }, [model]);

  const [act, setAct] = useState<ExploreAct>("entry");
  const [settled, setSettled] = useState(false);
  const [selectedId, setSelectedId] = useState(opening);
  const [evidenceId, setEvidenceId] = useState(() => {
    const node = model.nodes.find((item) => item.id === opening);
    return node?.evidenceRefs[0] ?? model.evidence[0]?.id ?? "";
  });
  const [askIndex, setAskIndex] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const returnAct = useRef<ExploreAct>("world");

  const enter = useCallback((next: ExploreAct) => {
    setAct(next);
    setSettled(true);
  }, []);

  useEffect(() => {
    const requested = actFromQuery(new URLSearchParams(window.location.search).get("act") ?? undefined);
    if (requested !== "entry") {
      enter(requested);
      return;
    }
    /*
      The world settles behind the hero rather than after it (§17).

      Arriving from the landing's last frame, the reader should be looking at the same world
      through the entry copy, not at a black panel that turns into one when they click. So the
      composition settles on mount and ENTER WORLD only lifts the scrim -- which is also why
      entering costs nothing: there is no animation left to wait for.
    */
    const frame = window.requestAnimationFrame(() => setSettled(true));
    return () => window.cancelAnimationFrame(frame);
  }, [enter]);

  const selectNode = useCallback(
    (id: string) => {
      setSelectedId(id);
      const node = model.nodes.find((item) => item.id === id);
      const first = node?.evidenceRefs[0];
      if (first) setEvidenceId(first);
    },
    [model.nodes],
  );

  const openNode = useCallback(
    (id: string) => {
      selectNode(id);
      enter(narrow ? "object_focus" : "evidence");
    },
    [enter, narrow, selectNode],
  );

  const openRegion = useCallback(
    (regionId: string) => {
      const owner =
        model.nodes.find((node) => node.kind === "Claim" && node.evidenceRefs.includes(regionId)) ??
        model.nodes.find((node) => node.evidenceRefs.includes(regionId));
      if (owner) setSelectedId(owner.id);
      setEvidenceId(regionId);
      enter("evidence");
    },
    [enter, model.nodes],
  );

  const closeAsk = useCallback(() => setAct(returnAct.current), []);

  const openAsk = useCallback(() => {
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
    difference exists, so it is the one place the palette is used: amber on the objects the
    revision reached, dimmed on the ones it did not.
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
  const activeRegion = model.evidence.find((item) => item.id === evidenceId) ?? null;

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
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <Logomark size={20} />
          <b>TAVONEL</b>
        </Link>
        <p className={styles.crumb}>
          <span>WORLD</span>
          <span className={styles.badge}>{EXPLORE_COPY.badge}</span>
        </p>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.technicalButton}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            {EXPLORE_COPY.technical}
          </button>
          <Link href="/" className={styles.close} aria-label={EXPLORE_COPY.closeLabel}>
            <X size={15} aria-hidden="true" />
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

        <div className={styles.acts} inert={act === "entry"}>
          {scene === "world" ? (
            <WorldAct
              model={model}
              layout={layout}
              states={worldStates}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onOpen={openNode}
              reduced={reduced}
              settled={settled}
              dimmed={act === "entry"}
            />
          ) : null}

          {scene === "object_focus" || scene === "evidence" ? (
            <EvidenceAct
              model={model}
              selectedId={selectedNode.id}
              evidenceId={evidenceId}
              onSelectRegion={setEvidenceId}
              onSelectObject={selectNode}
              onOpenSource={() => enter("evidence")}
              onBack={() => enter(scene === "evidence" && narrow ? "object_focus" : "world")}
              reduced={reduced}
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
              onSelect={setSelectedId}
              onOpen={setSelectedId}
              reduced={reduced}
              settled={settled}
            />
          ) : null}
        </div>

        {act === "entry" ? (
          <div className={styles.entry}>
            <p className={styles.entryEyebrow}>EXPLORE · NO LOGIN REQUIRED</p>
            <h1>{EXPLORE_COPY.hero}</h1>
            <p className={styles.entrySub}>{EXPLORE_COPY.sub}</p>
            <button type="button" className={styles.entryCta} onClick={() => enter("world")}>
              {EXPLORE_COPY.enter}
            </button>
          </div>
        ) : null}

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
        <p>YOUR SOURCES</p>
        <h2>{EXPLORE_COPY.endHeading}</h2>
        <div>
          {EXPLORE_COPY.endActions.map((action) => (
            <Link
              key={action.href}
              href={action.href as Route}
              data-primary={action.primary ? "1" : "0"}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
