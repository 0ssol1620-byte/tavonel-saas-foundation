"use client";

/**
 * Scene 09 -- the payoff. The same question, put to the world before the change and the world
 * after it, side by side.
 *
 * The third question is the one that earns the page. Every product in this category can show a
 * correct answer; showing the system *decline* to answer, name the specific conflict and route
 * it to a person is something a retrieval index structurally cannot do, because it has no
 * notion of an identity it failed to resolve.
 */

import { useState } from "react";
import { WORLD } from "@/lib/demo-world";

type Verdict = "stale" | "current" | "held" | "unchanged";

interface Answer {
  question: string;
  before: { verdict: Verdict; headline: string; note: string };
  after: { verdict: Verdict; headline: string; note: string };
  source: string;
}

const ANSWERS: Answer[] = [
  {
    question: "How many days a week do I need to be in the office?",
    before: {
      verdict: "stale",
      headline: "Three days a week.",
      note: "Confident, sourced, and wrong since 11:04 this morning.",
    },
    after: {
      verdict: "current",
      headline: "Two days a week.",
      note: "The handbook changed this morning. This answer changed with it.",
    },
    source: "Employee Handbook 2026.pdf · §3.2 · page 7 · lines 14–16",
  },
  {
    question: "What is the expense approval limit?",
    before: { verdict: "stale", headline: "Above $500.", note: "The figure the old world still holds." },
    after: { verdict: "current", headline: "Above $1,000.", note: "Raised in version 18, and traced to the line that raised it." },
    source: "Employee Handbook 2026.pdf · §5.4 · page 22 · lines 3–9",
  },
  {
    question: "Who approves a remote-work exception?",
    before: { verdict: "stale", headline: "Your manager.", note: "One reading, stated as if it were the only one." },
    after: {
      verdict: "held",
      headline: "I can’t answer this one yet.",
      note: "Version 18 names two different approvers for the same exception. Rather than average them into a confident sentence, this fact is held out of the live world and a person has been notified.",
    },
    source: "Employee Handbook 2026.pdf · §4.1 and §9.6 · two readings",
  },
  {
    question: "What is the company mission?",
    before: { verdict: "unchanged", headline: "Identical.", note: "Nothing in this revision touches it." },
    after: {
      verdict: "unchanged",
      headline: "Identical, and not rebuilt.",
      note: "Proven to have no dependency on anything that moved, so it was carried straight across.",
    },
    source: "Company Handbook 2026.pdf · §1.1 · page 2",
  },
];

const LABEL: Record<Verdict, string> = {
  stale: "STALE",
  current: "CURRENT",
  held: "NEEDS REVIEW",
  unchanged: "UNCHANGED",
};

export default function AnswerSwitch() {
  const [index, setIndex] = useState(0);
  const answer = ANSWERS[index];

  return (
    <>
      <div className="qswitch rv" role="tablist" aria-label="Example questions">
        {ANSWERS.map((item, i) => (
          <button
            key={item.question}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={i === index ? "q on" : "q"}
            onClick={() => setIndex(i)}
          >
            {item.question}
          </button>
        ))}
      </div>

      <div className="panel rv">
        <div className="panel-head">
          <span>&ldquo;{answer.question}&rdquo;</span>
          <span className="right">DEMO DATA</span>
        </div>
        <div className="twoworlds">
          {(["before", "after"] as const).map((side) => {
            const value = answer[side];
            return (
              <div className="wcol" key={side}>
                <div className="whead">
                  <span className="wv">
                    World v{side === "before" ? WORLD.versionBefore : WORLD.versionAfter}
                    <i>{side === "before" ? "before the change" : "current"}</i>
                  </span>
                  <span className="pill" data-v={value.verdict}>
                    {LABEL[value.verdict]}
                  </span>
                </div>
                <p className="wa">{value.headline}</p>
                <p className="wn">{value.note}</p>
              </div>
            );
          })}
        </div>
        <div className="wsrc">
          <span className="k">Where this came from</span>
          <span className="v">{answer.source}</span>
        </div>
      </div>
    </>
  );
}
