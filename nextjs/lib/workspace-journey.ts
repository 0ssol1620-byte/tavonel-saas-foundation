import type { WorkspaceSurface } from "@/components/workspace-ultimate-shell";
import type { WorkflowKind } from "./solution-proof-picks";
import type { WorkspaceStateInput } from "./workspace-onboarding";

/*
  The nine V30 journey steps as a location rail. It reads the same facts `deriveOnboardingSteps`
  reads and does not replace that six-step checklist; it adds the steps the checklist has no fact
  for (intent, organizing, ongoing, control/exit). Purpose is a local preference, never a server fact.
*/

export type Purpose = WorkflowKind | "other";

export const PURPOSES: readonly { id: Purpose; label: string }[] = [
  { id: "ai-ready-knowledge", label: "Make my documents ready for AI" },
  { id: "document-intelligence", label: "Read and extract from documents" },
  { id: "knowledge-graph", label: "See how my knowledge connects" },
  { id: "source-grounded-assistants", label: "Answer questions with cited sources" },
  { id: "knowledge-operations", label: "Keep knowledge current over time" },
  { id: "other", label: "Something else" },
];

/** A stored value that is not a current purpose (stale or edited localStorage) is unset. */
export function parsePurpose(value: unknown): Purpose | null {
  return PURPOSES.find((purpose) => purpose.id === value)?.id ?? null;
}

export type JourneyState = "done" | "current" | "todo" | "unavailable";
export type JourneyStep = {
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  id: "intent" | "source" | "preflight" | "processing" | "organizing" | "first-world" | "ai-connection" | "ongoing" | "control";
  title: string;
  state: JourneyState;
  surface: WorkspaceSurface;
};

export type JourneyInput = WorkspaceStateInput & { purpose: Purpose | null; libraryAvailable: boolean };

export function deriveJourney(input: JourneyInput): JourneyStep[] {
  const compileStarted = input.hasCandidate || input.compileJobState != null;
  const rows: [JourneyStep["id"], string, boolean | "unavailable", WorkspaceSurface][] = [
    ["intent", "Choose a purpose", parsePurpose(input.purpose) !== null, "home"],
    ["source", "Add sources", input.documentCount > 0, "sources"],
    ["preflight", "Check and start", compileStarted, "sources"],
    ["processing", "Processing", input.hasCandidate, "runs"],
    ["organizing", "Organizing", input.libraryAvailable ? false : "unavailable", "sources"],
    ["first-world", "First World", input.activeRevision !== null, "world"],
    ["ai-connection", "Connect to AI", input.hasAiConnection, "connections"],
    ["ongoing", "Ongoing changes", (input.activeRevision ?? 0) >= 2, "changes"],
    ["control", "Control and exit", false, "settings"],
  ];
  let currentSeen = false;
  return rows.map(([id, title, done, surface], index) => {
    let state: JourneyState = done === "unavailable" ? "unavailable" : done ? "done" : "todo";
    if (state === "todo" && !currentSeen) { state = "current"; currentSeen = true; }
    return { step: (index + 1) as JourneyStep["step"], id, title, state, surface };
  });
}
