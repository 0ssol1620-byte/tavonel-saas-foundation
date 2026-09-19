import snapshotJson from "./landing-v2-snapshot.json";
import type { EvidenceRecord, ProofTab, RecompileView } from "./landing-v2-proof";
import type { SourcesCopy, SourcesSceneData } from "./landing-v2-sources";
import type { VisualState } from "./visual-world-model";

export type { EvidenceRecord, ProofTab, RecompileView, SourcesSceneData };

type LandingSnapshot = {
  schema: string;
  tabs: ProofTab[];
  record: EvidenceRecord;
  recompile: RecompileView;
  sources: SourcesSceneData;
  sourcesCopy: Record<"en" | "ko", SourcesCopy>;
  stateWords: Record<"en" | "ko", Record<VisualState, string>>;
};

// A committed projection of the frozen public corpus, verified against the real builders
// by landing-v2-runtime.test.ts on every build. Never cache runtime access/billing policy here.
// Type-only imports above must stay erased: their builders compile the corpus on import.
function state(value: string): VisualState {
  switch (value) {
    case "current": case "candidate": case "changed": case "affected": case "unresolved": case "dim":
      return value;
    default: throw new Error("Invalid public-proof state: " + value);
  }
}
function twoLines(lines: string[]): readonly [string, string] {
  if (lines.length !== 2) throw new Error("Invalid public-proof compiler label");
  return [lines[0], lines[1]];
}
if (snapshotJson.schema !== "tavonel.landing-public-proof.v1") throw new Error("Unknown public-proof snapshot");
const snapshot: LandingSnapshot = {
  ...snapshotJson,
  record: { ...snapshotJson.record, status: { ...snapshotJson.record.status, state: state(snapshotJson.record.status.state) } },
  recompile: { ...snapshotJson.recompile, affectedSample: snapshotJson.recompile.affectedSample.map(item => ({ ...item, state: state(item.state) })) },
  sourcesCopy: {
    en: { ...snapshotJson.sourcesCopy.en, compilerLines: twoLines(snapshotJson.sourcesCopy.en.compilerLines) },
    ko: { ...snapshotJson.sourcesCopy.ko, compilerLines: twoLines(snapshotJson.sourcesCopy.ko.compilerLines) },
  },
};

export const buildProofTabs = (): ProofTab[] => snapshot.tabs;
export const buildEvidenceRecord = (): EvidenceRecord => snapshot.record;
export const buildRecompileView = (): RecompileView => snapshot.recompile;
export const sourcesScene = (): SourcesSceneData => snapshot.sources;
export const SOURCES_COPY = snapshot.sourcesCopy;

export function landingV2StateWord(state: VisualState, locale: "en" | "ko"): string {
  return snapshot.stateWords[locale][state];
}

export function fillSourcesFormat(format: string, values: Record<string, string | number>): string {
  return format.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : String(value);
  });
}
