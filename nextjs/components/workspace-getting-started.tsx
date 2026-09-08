"use client";

import Link from "next/link";
import { Check, ChevronDown, CircleHelp } from "lucide-react";
import { useEffect, useState } from "react";
import type { OnboardingStep } from "@/lib/workspace-onboarding";

type Props = {
  autoOpenEligible: boolean;
  steps: OnboardingStep[];
  hasActiveWorld: boolean;
  next: { label: string; run: () => void };
  onOpenWorld: () => void;
};

const DISMISSED_KEY = "tavonel.workspace.getting-started.dismissed.v1";

export default function WorkspaceGettingStarted({
  autoOpenEligible,
  steps,
  hasActiveWorld,
  next,
  onOpenWorld,
}: Props) {
  const [open, setOpen] = useState(false);
  const completed = steps.filter((step) => step.done).length;

  useEffect(() => {
    if (!autoOpenEligible) return;
    try {
      const dismissed = window.localStorage.getItem(DISMISSED_KEY) === "1";
      if (!dismissed && !hasActiveWorld) setOpen(true);
    } catch {
      if (!hasActiveWorld) setOpen(true);
    }
  }, [autoOpenEligible, hasActiveWorld]);

  const dismiss = () => {
    setOpen(false);
    try { window.localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* localStorage can be unavailable */ }
  };

  return (
    <section className="workspace-getting-started" data-open={open} aria-label="Getting started">
      <button
        type="button"
        className="workspace-getting-started-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span><CircleHelp size={15} aria-hidden="true" /><strong>{hasActiveWorld ? "Using your World" : "Getting started"}</strong></span>
        <span>{completed} of {steps.length} complete <ChevronDown size={14} aria-hidden="true" /></span>
      </button>

      {open ? (
        <div className="workspace-getting-started-body">
          <div className="workspace-getting-started-copy">
            <p className="eyebrow">FIRST SUCCESS</p>
            <h2>{hasActiveWorld ? "Your World is ready to use." : "The short path to a useful Compiled World."}</h2>
            <p>
              Add a source, compile a candidate, review what needs a decision, then activate.
              Nothing an AI reads becomes your current World until you activate it.
            </p>
          </div>

          {/*
            Each row's state is read from the workspace, not from a "you have seen this" flag.
            Hiding the guide hides the guide; it cannot tick a step the workspace has not reached.
          */}
          <ol className="workspace-getting-started-steps">
            {steps.map((step) => (
              <li key={step.id} data-done={step.done}>
                <span>{step.done ? <Check size={14} aria-hidden="true" /> : null}</span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                  <small className="workspace-step-state">{step.done ? "Done" : "Not yet"}</small>
                </div>
              </li>
            ))}
          </ol>

          <div className="workspace-getting-started-actions">
            <button type="button" onClick={next.run}>{next.label}</button>
            {hasActiveWorld ? <button type="button" className="secondary" onClick={onOpenWorld}>Open World</button> : null}
            <Link href="/docs/use-with-ai">How to use results with AI</Link>
            <button type="button" className="text" onClick={dismiss}>Hide guide</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
