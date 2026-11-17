/*
  The Agent access consent copy (workorders/agent-native.md §2.7), shown before *Create*.
  This module has no dependency at all, so the client panel that renders it pulls in no Node built-in.
  Server and template text only: the client label is the one slot, always in quotes, and the panel
  marks it with AGENT_CLIENT_LABEL_UNVERIFIED. No digit, no plan name, no token or prefix.
*/

export const AGENT_CLIENT_LABEL_UNVERIFIED = "(name not verified)";

export const AGENT_PROPOSAL_CONSENT = {
  sees: (label: string) =>
    `“${label}” will see the list of your documents, the status of your Worlds and compile jobs, the topics, entities, claims and evidence references of your Worlds — including Worlds that are not active yet — and the suggestions it makes.`,
  suggests: "It can suggest: compiling documents, library labels and label corrections.",
  cannotChange: "It cannot make any of these changes. Each suggestion waits in Changes until it is confirmed in a signed-in TAVONEL session.",
  cannotReach: "It cannot read or upload files from your computer and cannot spend credits.",
  disconnect: "You can disconnect it at any time here, under Agent access.",
  securityNote:
    "A suggestion is carried out only when it is confirmed in a signed-in TAVONEL session. Anything that can use that session — including a browser that an agent controls — can confirm.",
} as const;
