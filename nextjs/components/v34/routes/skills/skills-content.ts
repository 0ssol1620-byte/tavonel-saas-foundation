import { v34Route } from "@/lib/v34/routes";

/*
  The words of the skills page that are not the shared pieces'. Plain data, so the guard test can
  read every sentence in one place. No number is typed here: ordinals are counted from list position.
  The route is held, so every line says what the page is for and promises no date. The manifest is
  an example of the shape a Skill takes, labelled as such.
*/

export const HERO_ACTIONS = {
  connect: { href: v34Route("connect").path, label: "Connect your AI" },
  capabilities: { href: v34Route("capabilities").path, label: "See what the compiler can do" },
} as const;

export const CONTRACT = {
  eyebrow: "Interface contract",
  title: "Every capability has a contract.",
  art: {
    label: "A manifest card with field lines, a check mark on each, and a gate before an action",
    caption: "A drawn manifest. Each field is checked, and an action sits behind its own gate.",
  },
  items: [
    { title: "Signed manifest", text: "The version and the publisher identity travel with the Skill." },
    { title: "Validated input", text: "Inputs are typed and bounded before anything runs." },
    { title: "Least privilege", text: "Read scopes name the Worlds a Skill may read." },
    { title: "Separate approval", text: "An action policy decides what needs a person to approve it." },
  ],
} as const;

export const EXAMPLE = {
  eyebrow: "Example Skill",
  title: "Compare a source revision.",
  lead: "A read-only analysis. It reads an earlier and a later version of a source from a World and returns a diff with the evidence behind it.",
  manifestLabel: "Example manifest",
  manifest: [
    "intent: compare_revisions",
    "inputs: source_id, old, new",
    "outputs: diff, evidence_refs",
    "permissions: [world:read]",
    "network: none",
    "write: false",
    "review: required_if_uncertain",
  ].join("\n"),
} as const;

export const TRUST = {
  title: "What makes a Skill trustworthy?",
  rows: [
    { title: "Identity", text: "Signed version and publisher identity." },
    { title: "Inputs", text: "Typed schemas and bounds." },
    { title: "Evidence", text: "Sources pinned, scoped and checked." },
    { title: "Effects", text: "A write needs a permitted action and an approval." },
    { title: "Tests", text: "Golden cases, permission checks, replay and rollback." },
    { title: "Upgrade", text: "An explicit diff, a compatibility check and a fresh approval when privilege expands." },
  ],
} as const;

export const FINAL = {
  title: "Start from a World you can inspect.",
  secondary: { href: v34Route("world").path, label: "Open the reference World" },
} as const;
