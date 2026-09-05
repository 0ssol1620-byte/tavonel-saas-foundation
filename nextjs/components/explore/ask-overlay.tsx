"use client";

/*
  Ask, as a command on the stage rather than a sidebar (§19).

  It offers three questions instead of a text field, and that is the honest shape of this
  surface: the sample's answers come from the retriever running over this artifact at build
  time, so a box that accepted any sentence would either have to ship the retriever and the
  corpus to the browser or quietly fail on the fourth question. A control that only looks like it
  accepts anything is worse than one that says what it does.

  The answer is the source text the retriever scored highest, shown as a quotation, and every
  region under it opens Act 2 at that region -- Question → World → Knowledge → Evidence →
  Original source, walked rather than described.
*/

import { useEffect, useRef } from "react";
import { Quote, X } from "lucide-react";
import styles from "./explore-stage.module.css";
import { EXPLORE_COPY, type ExploreAnswerView } from "@/lib/explore-story";

export default function AskOverlay({
  answers,
  index,
  onSelectQuestion,
  onOpenRegion,
  onClose,
}: {
  answers: ExploreAnswerView[];
  index: number;
  onSelectQuestion: (index: number) => void;
  onOpenRegion: (evidenceId: string) => void;
  onClose: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const answer = answers[index] ?? answers[0];

  return (
    <section className={styles.askPanel} role="dialog" aria-label="Ask this World">
      <header>
        <span>{EXPLORE_COPY.askPlaceholder}</span>
        <button type="button" onClick={onClose} aria-label="Close Ask">
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <div className={styles.askQuestions} role="group" aria-label="Questions this sample answers">
        {answers.map((item, position) => (
          <button
            key={item.question}
            type="button"
            ref={position === 0 ? firstRef : undefined}
            aria-pressed={position === index}
            onClick={() => onSelectQuestion(position)}
          >
            {item.question}
          </button>
        ))}
      </div>

      <blockquote className={styles.askAnswer}>{answer.answer}</blockquote>

      <div className={styles.askRegions}>
        <p>
          {answer.regions.length} SOURCE REGION{answer.regions.length === 1 ? "" : "S"}
        </p>
        {answer.regions.map((region) => (
          <button key={region.evidenceId} type="button" onClick={() => onOpenRegion(region.evidenceId)}>
            <Quote size={12} aria-hidden="true" />
            <span>{region.filename}</span>
            <b>PAGE {region.page}</b>
          </button>
        ))}
      </div>

      <p className={styles.askNote}>{EXPLORE_COPY.askNote}</p>
    </section>
  );
}
