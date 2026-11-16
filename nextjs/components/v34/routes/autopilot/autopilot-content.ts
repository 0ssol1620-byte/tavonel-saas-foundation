import { v34Route } from "@/lib/v34/routes";

/*
  The words of the autopilot page that are not the shared pieces'. Plain data, so the guard test can
  read every sentence in one place. No number is typed here: ordinals are counted from list position.
  The route is held, so every line says what the page is for and promises no date.
*/

export const HERO_ACTIONS = {
  connect: { href: v34Route("connect").path, label: "Connect your AI" },
  changes: { href: v34Route("changes").path, label: "See how changes are compared" },
} as const;

export const BRIEFING = {
  title: "A daily briefing that respects your decisions.",
  lead: "These kinds of item reach the briefing, each with the step that follows it.",
  steps: [
    { name: "New source revision", kind: "Inspect" },
    { name: "Uncertain extraction", kind: "Hold" },
    { name: "Draft follow-up", kind: "Approve separately" },
    { name: "Routine digest", kind: "Quiet" },
  ],
} as const;

export const REVIEW = {
  eyebrow: "Reviewed actions",
  title: "Every action is reviewed in the open.",
  art: {
    label: "Source revisions flowing into one proposal card, then through a review gate to a World",
    caption: "A drawn proposal passing a review gate. The World changes only after the gate.",
  },
  items: [
    {
      title: "A proposal names its scope",
      text: "Each proposal states the record it touches, the source that prompted it and the reason, so a person can check the evidence before deciding.",
    },
    {
      title: "Approval is a separate step",
      text: "A pending proposal changes nothing in the World. Approval is recorded with the proposal it belongs to.",
    },
  ],
} as const;

export const AUTONOMY = {
  title: "A predictable autonomy model.",
  steps: [
    { title: "Observe", text: "Monitor authorized sources and report change events." },
    { title: "Recommend", text: "Draft next steps with supporting evidence, the expected impact and a reason." },
    { title: "Prepare", text: "Build a reversible proposal, validate its parameters and name the target records." },
    { title: "Execute", text: "Only authorized integrations perform writes, and sensitive actions wait for approval." },
    { title: "Audit", text: "Record the request, the entitlement, the result and any compensating step." },
  ],
} as const;

export const FINAL = {
  title: "Define what your agent may access.",
  secondary: { href: v34Route("capabilities").path, label: "See what the compiler can do" },
} as const;
