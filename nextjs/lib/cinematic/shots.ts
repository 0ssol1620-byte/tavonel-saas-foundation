/**
 * Master shot board — S00–S20.
 *
 * Source of truth: TAVONEL_CINEMATIC_COMPILATION_REPLAY_MASTER_SPEC_v2.0_FINAL_KO_2026-08-23 §4,
 * whose §0.1 authority order supersedes the 2026-08-21 Manus brief (H00–H23 / 66s) and the
 * 2026-08-20 spec. Times and beat names below are that document's §4 table, verbatim.
 *
 * Frame law (§4): start_frame = round(start_time * 60) at 60fps canonical. A shot's end frame
 * is the next shot's start frame minus one. 60fps is an editorial reference — actual playback
 * is driven by a monotonic clock, never a setTimeout chain.
 */

export const CANONICAL_FPS = 60;
export const SEQUENCE_DURATION_SECONDS = 56;

export type ActId = "TRANSFORM" | "INTELLIGENCE" | "PROOF" | "PAYOFF";

export type ShotId =
  | "S00" | "S01" | "S02" | "S03" | "S04" | "S05" | "S06"
  | "S07" | "S08" | "S09" | "S10" | "S11" | "S12" | "S13"
  | "S14" | "S15" | "S16" | "S17" | "S18" | "S19" | "S20";

/** §7.5 — the only five camera verbs. No orbit, no roll, no game camera. */
export type CameraVerb = "PUSH_IN" | "PULL_OUT" | "LATERAL" | "DEPTH_SHIFT" | "HOLD";

export type Shot = {
  readonly id: ShotId;
  readonly act: ActId;
  /** §4's scene name. */
  readonly beat: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly camera: CameraVerb;
  /** §6.5 — maximum simultaneously readable labels for this state. */
  readonly labelBudget: number;
  /** §4's "핵심 이해" column, rendered as the narration line for this beat. */
  readonly takeaway: string;
  /**
   * Founder approval frame. Reassigned from the superseded H-board (H01/H06/H08/H16) to
   * S02/S10/S16/S19 — S02 and S19 carry the §1.2 five-second and forty-five-second tests.
   * These four frames are also the only ones cleared to leave the site as social assets.
   */
  readonly gate?: true;
};

const ACT_OF: Record<ShotId, ActId> = {
  S00: "TRANSFORM", S01: "TRANSFORM", S02: "TRANSFORM", S03: "TRANSFORM",
  S04: "TRANSFORM", S05: "TRANSFORM", S06: "TRANSFORM", S07: "TRANSFORM",
  S08: "TRANSFORM", S09: "TRANSFORM", S10: "TRANSFORM",
  S11: "INTELLIGENCE", S12: "INTELLIGENCE", S13: "INTELLIGENCE",
  S14: "PROOF", S15: "PROOF", S16: "PROOF", S17: "PROOF",
  S18: "PAYOFF", S19: "PAYOFF", S20: "PAYOFF",
};

type ShotSeed = [ShotId, string, number, number, CameraVerb, number, string, true?];

const SEEDS: readonly ShotSeed[] = [
  ["S00", "Product frame / orientation", 0.0, 0.65, "HOLD", 4,
    "You are inside the product from the first frame."],
  ["S01", "Source connection", 0.65, 1.45, "HOLD", 6,
    "Folders, notes, code and cloud enter as one world of material."],
  ["S02", "Discovery timelapse", 1.45, 3.1, "PUSH_IN", 6,
    "Structure is discovered at a speed you can feel.", true],
  ["S03", "Classification stream", 3.1, 4.2, "LATERAL", 6,
    "It is choosing a processing route, not reading a file extension."],
  ["S04", "OCR / structure read", 4.2, 5.8, "PUSH_IN", 5,
    "Scanned pages are read, and what was read stays tied to where it was found."],
  ["S05", "Semantic extraction", 5.8, 7.2, "DEPTH_SHIFT", 8,
    "Documents become meaning you can point at."],
  ["S06", "Stable identity convergence", 7.2, 8.65, "HOLD", 6,
    "Written differently, recognised as the same thing."],
  ["S07", "Authority + time resolution", 8.65, 10.1, "HOLD", 7,
    "Of several candidates, one is what currently governs."],
  ["S08", "Ontology + dependency formation", 10.1, 11.65, "PULL_OUT", 8,
    "A pile of files becomes a world with relationships."],
  ["S09", "Projection flash", 11.65, 12.75, "PULL_OUT", 6,
    "One truth, several views."],
  ["S10", "First world promotion", 12.75, 14.5, "HOLD", 8,
    "The whole transformation closes as one finished picture.", true],
  ["S11", "Explain — what belongs together", 14.5, 17.8, "PUSH_IN", 6,
    "Replayed slowly: how the same thing is recognised."],
  ["S12", "Explain — what is current", 17.8, 21.4, "HOLD", 7,
    "Replayed slowly: which answer is true now."],
  ["S13", "Explain — dependency", 21.4, 25.5, "PULL_OUT", 8,
    "Before anything changes, what depends on what."],
  ["S14", "Authoritative source edit", 25.5, 28.3, "PUSH_IN", 6,
    "Reality changes in one line of an approved source."],
  ["S15", "Semantic diff + impact", 28.3, 32.0, "LATERAL", 9,
    "Not a character change — a meaning change, and its reach."],
  ["S16", "Signature — selective recompilation", 32.0, 36.8, "HOLD", 6,
    "Only what was affected is recomputed. Everything else does not move.", true],
  ["S17", "New world promotion", 36.8, 40.1, "HOLD", 6,
    "The new current is verified, then activated at once."],
  ["S18", "Ask the current world", 40.1, 44.8, "PUSH_IN", 8,
    "Your AI stops searching files and reads the current world."],
  ["S19", "Evidence return / facing pages", 44.8, 49.5, "PUSH_IN", 10,
    "Every answer has a way home.", true],
  ["S20", "Control handoff", 49.5, 56.0, "PULL_OUT", 6,
    "The film does not end. It becomes the tool."],
];

export const SHOTS: readonly Shot[] = SEEDS.map(
  ([id, beat, startSeconds, endSeconds, camera, labelBudget, takeaway, gate]) => ({
    id,
    act: ACT_OF[id],
    beat,
    startSeconds,
    endSeconds,
    startFrame: Math.round(startSeconds * CANONICAL_FPS),
    endFrame: Math.round(endSeconds * CANONICAL_FPS) - 1,
    camera,
    labelBudget,
    takeaway,
    ...(gate ? { gate } : {}),
  }),
);

export const ACTS: readonly { id: ActId; title: string; from: number; to: number }[] = [
  { id: "TRANSFORM", title: "Whole transformation", from: 0.0, to: 14.5 },
  { id: "INTELLIGENCE", title: "Zoom into intelligence", from: 14.5, to: 25.5 },
  { id: "PROOF", title: "Signature causal proof", from: 25.5, to: 40.1 },
  { id: "PAYOFF", title: "Payoff and handoff", from: 40.1, to: 56.0 },
];

export const GATE_SHOTS: readonly ShotId[] = SHOTS.filter((s) => s.gate).map((s) => s.id);

export function shotAt(seconds: number): Shot {
  const clamped = Math.min(Math.max(seconds, 0), SEQUENCE_DURATION_SECONDS - 0.0001);
  for (const shot of SHOTS) {
    if (clamped >= shot.startSeconds && clamped < shot.endSeconds) return shot;
  }
  return SHOTS[SHOTS.length - 1];
}

/** 0 → 1 within the given shot. Used for intra-beat interpolation, never for scheduling. */
export function shotProgress(shot: Shot, seconds: number): number {
  const span = shot.endSeconds - shot.startSeconds;
  if (span <= 0) return 1;
  return Math.min(Math.max((seconds - shot.startSeconds) / span, 0), 1);
}

export function isAtOrAfter(seconds: number, id: ShotId): boolean {
  const shot = SHOTS.find((s) => s.id === id);
  return shot ? seconds >= shot.startSeconds : false;
}
