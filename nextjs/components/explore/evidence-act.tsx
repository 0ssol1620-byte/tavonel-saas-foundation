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
import styles from "./explore-stage.module.css";
import type { VisualEvidence, VisualState, VisualWorldModel } from "@/lib/visual-world-model";

const KIND_WORD: Record<string, string> = {
  Claim: "CLAIM",
  Document: "DOCUMENT",
  Entity: "ENTITY",
  Topic: "TOPIC",
  Evidence: "SOURCE",
};

const STATE_WORD: Record<VisualState, string> = {
  current: "CURRENT",
  candidate: "CANDIDATE",
  changed: "CHANGED",
  affected: "AFFECTED",
  unresolved: "UNRESOLVED",
  dim: "UNCHANGED",
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
  const active = regions.find((item) => item.id === evidenceId) ?? regions[0];

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
              <dd>
                {node.evidenceRefs.length} source region{node.evidenceRefs.length === 1 ? "" : "s"}
              </dd>
            </div>
            <div>
              <dt>Relations</dt>
              <dd>{node.degree}</dd>
            </div>
          </dl>
        </div>

        {neighbours.length > 0 ? (
          <ul className={styles.relationList}>
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
        {active ? (
          <SourceSheet regions={regions} activeId={active.id} onSelectRegion={onSelectRegion} />
        ) : (
          <p className={styles.paneEmpty}>
            This object carries no page-bound region in the compiled artifact, so there is no source
            to open.
          </p>
        )}
        {regions.length > 1 ? (
          <div className={styles.regionSwitch} role="group" aria-label="Source regions for this object">
            {regions.map((region, index) => (
              <button
                key={region.id}
                type="button"
                aria-pressed={region.id === active?.id}
                onClick={() => onSelectRegion(region.id)}
              >
                REGION {index + 1}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <ProvenanceTether
        hostRef={hostRef}
        from="[data-object-card]"
        to="[data-active-region]"
        activeKey={`${node.id}:${active?.id ?? ""}:${step}`}
        reduced={reduced}
      />
    </div>
  );
}
