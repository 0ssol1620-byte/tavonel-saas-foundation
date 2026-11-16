import { v34Route } from "@/lib/v34/routes";

/*
  The words of the steward page that are not the shared pieces'. Plain data, so the guard test can
  read every sentence in one place. No number is typed here: ordinals are counted from list position.
  The route is held, so every line says what the page is for and promises no date.
*/

export const HERO_ACTIONS = {
  evidence: { href: v34Route("evidence").path, label: "Inspect the evidence" },
  changes: { href: v34Route("changes").path, label: "See how changes are compared" },
} as const;

export const QUEUE = {
  title: "The inbox is an evidence queue.",
  lead: "A steward works through four kinds of item, each with the step that follows it.",
  steps: [
    { name: "Stale claim", kind: "Review" },
    { name: "Conflict", kind: "Hold" },
    { name: "Revoked source", kind: "Invalidate" },
    { name: "New useful relation", kind: "Suggest" },
  ],
} as const;

export const INBOX = {
  eyebrow: "Review inbox",
  title: "Each item keeps its evidence in view.",
  lead: "Illustrative items.",
  art: {
    label: "A list of three review rows, the first one open, with a hold mark beside the second",
    caption: "A drawn review queue. The open row shows its evidence, the held row waits for an owner.",
  },
  items: [
    {
      title: "Source change",
      text: "A new revision of a source arrives. The records it touches are listed so a person can check which procedures depend on them.",
    },
    {
      title: "Conflicting procedures",
      text: "Two procedures disagree. The item is held until an authorized owner validates the current version.",
    },
    {
      title: "Expired data grant",
      text: "Retrieval stops and the owner is told, without revealing the removed content.",
    },
  ],
} as const;

export const MAINTENANCE = {
  title: "Maintenance without surprises.",
  steps: [
    { title: "Change detection", text: "Poll or consume authorized events, checkpoint source revisions, reconcile and stage only the affected knowledge." },
    { title: "Risk prioritization", text: "Rank by dependency impact, source authority, freshness and unresolved critical values." },
    { title: "Review and recovery", text: "Deduplicate notifications, preserve unresolved state, allow acknowledge and snooze, and restore an accepted revision." },
    { title: "Service boundaries", text: "Sources stay within the approved scope. A person is asked whenever policy requires one." },
  ],
} as const;

export const FINAL = {
  title: "Turn a reviewed workflow into a Skill.",
  secondary: { href: v34Route("capabilities").path, label: "See what the compiler can do" },
} as const;
