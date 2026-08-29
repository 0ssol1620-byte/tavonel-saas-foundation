/**
 * Exact copy deck — SPEC §13.1, verbatim.
 *
 * This is the only place public strings for the directed sequence live. §13.3 bars a specific
 * list of phrases ("Unlock your data", "Your second brain", "100% accurate", "Never
 * hallucinates", "better than RAG" before the external experiment closes, and others); nothing
 * here may drift toward them.
 *
 * §3.2 bars proper nouns before the world has formed, which is why the truth scene asks about a
 * "Launch date" rather than naming a project.
 */

export const BRAND = { name: "TAVONEL", category: "THE KNOWLEDGE COMPILER" } as const;

export const OPENING = "Watch scattered files become one current world.";

export const TIMELAPSE_STAGES = [
  "DISCOVERING SOURCES",
  "READING STRUCTURE",
  "RESOLVING IDENTITIES",
  "BUILDING RELATIONSHIPS",
  "VERIFYING THE WORLD",
] as const;

export const FIRST_PAYOFF = {
  headline: "YOUR DIGITAL WORLD, COMPILED.",
  lines: ["Current.", "Connected.", "Source-linked."],
} as const;

export const EXPLANATION = [
  "It knows what belongs together.",
  "It knows which information is true now.",
  "It knows what depends on what.",
] as const;

export const CHANGE = "When reality changes,\nTAVONEL updates with it.";

export const RECOMPILE = "UPDATING WHAT CHANGED.\nNOT EVERYTHING ELSE.";

export const ASK = {
  question: "What is the current launch date?",
  human: "Your AI stops searching through files.\nIt reads the current world.",
} as const;

export const EVIDENCE_CLOSE = "EVERY ANSWER HAS A WAY HOME.";

export const HANDOFF = "NOW COMPILE YOURS.";

export const CTA = {
  primary: "Scan your knowledge",
  secondary: "Explore the sample world",
  tertiary: "Inspect a public filing",
} as const;

/** §7.1 — printed on the site so the motion law is a public commitment, not a private note. */
export const MOTION_LAW = "TAVONEL moves only when reality, understanding, or control changes.";
