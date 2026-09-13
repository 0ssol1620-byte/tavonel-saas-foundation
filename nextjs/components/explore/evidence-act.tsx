"use client";

/*
  Act 2 -- EVIDENCE.

  One object on the left, the page it was compiled from on the right, and a drawn line between
  them. §18's composition, with §48's rule about what is on screen by default: the object's
  meaning, its state, how many regions support it and the page itself. The digest, the box
  coordinates, the evidence id and the compiler version are all real and all one button away in
  the technical drawer, which is where a reader who wants them will look and where a reader who
  does not will never be stopped by them.

  On a narrow screen this is two steps rather than two columns: the object, then its source.
  `act` is the step -- the same state machine, read differently by the stylesheet.
*/

import { useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import ProvenanceTether from "@/components/world-visual/provenance-tether";
import SourceSheet from "@/components/world-visual/source-sheet";
import { chooseExploreEntryProof } from "@/lib/explore-entry-proof";
import { STATE_WORD } from "./parallel-view";
import styles from "./explore-stage.module.css";
import { EXPLORE_COPY } from "@/lib/explore-story";
import type { VisualEvidence, VisualWorldModel } from "@/lib/visual-world-model";

const KIND_WORD: Record<string, string> = {
  Claim: "CLAIM",
  Document: "DOCUMENT",
  Entity: "ENTITY",
  Topic: "TOPIC",
  Evidence: "SOURCE",
};


export default function EvidenceAct({
  model,
  selectedId,
  evidenceId,
  onSelectRegion,
  onSelectObject,
  onOpenSource,
  onBack,
  reduced,
  step,
}: {
  model: VisualWorldModel;
  selectedId: string;
  evidenceId: string;
  onSelectRegion: (id: string) => void;
  onSelectObject: (id: string) => void;
  onOpenSource: () => void;
  onBack: () => void;
  reduced: boolean;
  step: "object_focus" | "evidence";
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const node = model.nodes.find((item) => item.id === selectedId);
  if (!node) return null;

  const regions: VisualEvidence[] = model.evidence.filter((item) => node.evidenceRefs.includes(item.id));
  /*
    BA-035 -- the proof is only proof if the words in the box can be read.

    The fallback was `regions[0]`, the object's first region in compiled order, which for a
    filing is its cover: the audit's screenshot of this pane is a highlight box over "Table of
    Contents" with the phrase itself clipped. When the reader has not chosen a region, the
    opening one is now picked the way /explore picks its entry proof -- past the cover pages,
    long enough to be a quotation -- and `regions[0]` remains the last resort for an object
    whose every region is a cover line. Presentation selection only: no excerpt, locator or
    coordinate is rewritten, and the reader can still step to any region in the set.
  */
  const active = regions.find((item) => item.id === evidenceId)
    ?? chooseExploreEntryProof(regions, [])
    ?? regions[0];
  const activeIndex = active ? regions.findIndex((item) => item.id === active.id) : -1;

  const neighbours = model.edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .map((edge) => ({
      predicate: edge.predicate,
      direction: edge.from === node.id ? "out" : "in",
      other: model.nodes.find((item) => item.id === (edge.from === node.id ? edge.to : edge.from)),
      id: edge.id,
    }))
    .filter((entry) => entry.other !== undefined);

  return (
    <div className={styles.evidenceAct} ref={hostRef} data-step={step}>
      <article className={styles.objectPane}>
        <header>
          {/* Named for what it does, not for where it lands: the rail already has a "WORLD"
              button, and two controls with the same accessible name is one too many. */}
          <button type="button" className={styles.paneBack} aria-label="Back to the World" onClick={onBack}>
            <ArrowLeft size={13} aria-hidden="true" /> World
          </button>
          <span>WORLD</span>
        </header>
        <div className={styles.objectCard} data-object-card="">
          <p className={styles.objectKind}>{KIND_WORD[node.kind] ?? node.kind.toUpperCase()}</p>
          <h2>{node.label}</h2>
          <dl className={styles.objectFacts}>
            <div>
              <dt>State</dt>
              <dd>{STATE_WORD[node.state]}</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              {/*
                The compiler's number, not the shipped one. `boundVisualWorld` sends the browser
                a prefix of an object's regions (§24), and printing the length of that prefix
                here would restate a payload size as a compiled fact.
              */}
              <dd>
                {node.evidenceCount} source region{node.evidenceCount === 1 ? "" : "s"}
              </dd>
            </div>
            <div>
              <dt>Relations</dt>
              <dd>{node.degree}</dd>
            </div>
          </dl>
        </div>

        {neighbours.length > 0 ? (
          <ul className={styles.objectRelations}>
            {neighbours.map((entry) => (
              <li key={entry.id}>
                <button type="button" onClick={() => onSelectObject(entry.other!.id)}>
                  <small>
                    {entry.direction === "out" ? "" : "← "}
                    {entry.predicate.replaceAll("_", " ").toUpperCase()}
                    {entry.direction === "out" ? " →" : ""}
                  </small>
                  <span>{entry.other!.label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {regions.length > 0 ? (
          <button type="button" className={styles.openSource} onClick={onOpenSource}>
            Open the source region <ArrowRight size={13} aria-hidden="true" />
          </button>
        ) : null}
      </article>

      <div className={styles.sourcePane}>
        <p className={styles.paneLabel}>SOURCE</p>
        {active ? <p className={styles.evidenceLead}>{EXPLORE_COPY.evidenceLead}</p> : null}
        {active ? (
          <SourceSheet regions={regions} activeId={active.id} onSelectRegion={onSelectRegion} />
        ) : (
          <p className={styles.paneEmpty}>
            This object carries no page-bound region in the compiled artifact, so there is no source
            to open.
          </p>
        )}
        {/*
          Explicit previous/next, not a row of numbered buttons (§19.1).

          An object in this corpus can carry twenty-odd regions, and a phone showing twenty
          numbered buttons has replaced navigation with a wall. Previous and Next are the two
          controls a reader on a narrow screen actually wants, and they are the same two controls
          on a wide one; the position between them says where they are.
        */}
        {regions.length > 1 && active ? (
          <div className={styles.regionSwitch} role="group" aria-label="Source regions for this object">
            <button
              type="button"
              disabled={activeIndex <= 0}
              onClick={() => onSelectRegion(regions[activeIndex - 1].id)}
            >
              ← PREVIOUS
            </button>
            {/*
              "of 12" is the number of regions this browser was sent, and when the compiler bound
              more than that the line says which number is which rather than letting the smaller
              one pass for the larger.
            */}
            <span aria-live="polite">
              REGION {activeIndex + 1} OF {regions.length}
              {node.evidenceCount > regions.length ? ` SHOWN · ${node.evidenceCount} COMPILED` : ""}
            </span>
            <button
              type="button"
              disabled={activeIndex >= regions.length - 1}
              onClick={() => onSelectRegion(regions[activeIndex + 1].id)}
            >
              NEXT →
            </button>
          </div>
        ) : null}
      </div>

      <ProvenanceTether
        hostRef={hostRef}
        from="[data-object-card]"
        to={'[data-source-sheet][data-source-view="original"] [data-original-region], [data-source-sheet][data-source-view="text"] [data-active-region]'}
        activeKey={`${node.id}:${active?.id ?? ""}:${step}`}
        reduced={reduced}
      />
    </div>
  );
}
