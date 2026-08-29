import { describe, expect, it } from "vitest";
import {
  ACTS, CANONICAL_FPS, GATE_SHOTS, SEQUENCE_DURATION_SECONDS, SHOTS, shotAt, shotProgress,
} from "./shots";
import {
  AFFECTED_COUNT, PROJECTION, WORLD_UNITS, FEED, RAIL_STAGES, SOURCE_GROUPS, groupCounts,
} from "./fixture";

describe("shot board", () => {
  it("runs exactly 56.00s with no gap and no overlap", () => {
    expect(SHOTS[0].startSeconds).toBe(0);
    expect(SHOTS[SHOTS.length - 1].endSeconds).toBe(SEQUENCE_DURATION_SECONDS);
    for (let i = 1; i < SHOTS.length; i += 1) {
      expect(SHOTS[i].startSeconds).toBeCloseTo(SHOTS[i - 1].endSeconds, 6);
    }
  });

  it("carries the twenty-one beats the spec names", () => {
    expect(SHOTS).toHaveLength(21);
    expect(SHOTS.map((s) => s.id)).toEqual(
      Array.from({ length: 21 }, (_, i) => `S${String(i).padStart(2, "0")}`),
    );
  });

  it("obeys the frame law: start_frame = round(t * 60), end = next start - 1", () => {
    for (let i = 0; i < SHOTS.length; i += 1) {
      const shot = SHOTS[i];
      expect(shot.startFrame).toBe(Math.round(shot.startSeconds * CANONICAL_FPS));
      if (i + 1 < SHOTS.length) {
        expect(shot.endFrame).toBe(SHOTS[i + 1].startFrame - 1);
      }
    }
  });

  it("puts the approval gates on S02, S10, S16 and S19", () => {
    expect(GATE_SHOTS).toEqual(["S02", "S10", "S16", "S19"]);
  });

  it("gives the signature beat the longest run in its act", () => {
    const proof = SHOTS.filter((s) => s.act === "PROOF");
    const longest = proof.reduce((a, b) =>
      b.endSeconds - b.startSeconds > a.endSeconds - a.startSeconds ? b : a,
    );
    expect(longest.id).toBe("S16");
  });

  it("keeps every act contiguous and correctly bounded", () => {
    for (const act of ACTS) {
      const inAct = SHOTS.filter((s) => s.act === act.id);
      expect(inAct.length).toBeGreaterThan(0);
      expect(inAct[0].startSeconds).toBeCloseTo(act.from, 6);
      expect(inAct[inAct.length - 1].endSeconds).toBeCloseTo(act.to, 6);
    }
  });

  it("stays inside the §6.5 label budget for every state", () => {
    for (const shot of SHOTS) {
      expect(shot.labelBudget).toBeGreaterThanOrEqual(4);
      expect(shot.labelBudget).toBeLessThanOrEqual(10);
    }
  });

  it("resolves a time to exactly one shot, including the boundaries", () => {
    expect(shotAt(0).id).toBe("S00");
    expect(shotAt(1.45).id).toBe("S02");
    expect(shotAt(3.0999).id).toBe("S02");
    expect(shotAt(32).id).toBe("S16");
    expect(shotAt(SEQUENCE_DURATION_SECONDS).id).toBe("S20");
    expect(shotAt(-5).id).toBe("S00");
  });

  it("clamps intra-beat progress to 0..1", () => {
    const s16 = SHOTS.find((s) => s.id === "S16")!;
    expect(shotProgress(s16, 31)).toBe(0);
    expect(shotProgress(s16, 34.4)).toBeCloseTo(0.5, 2);
    expect(shotProgress(s16, 99)).toBe(1);
  });
});

describe("showcase world fixture", () => {
  it("does not claim to be a compiler run", () => {
    expect(PROJECTION.label).toContain("NOT A COMPILER RUN");
    expect(PROJECTION.label).not.toContain("REAL COMPILER RUN");
  });

  it("keeps more than a hundred units still so the signature beat reads", () => {
    const unaffected = WORLD_UNITS.length - AFFECTED_COUNT;
    expect(unaffected).toBeGreaterThanOrEqual(100);
    expect(AFFECTED_COUNT).toBeGreaterThan(0);
  });

  it("reconciles the recompile projection with the unit list", () => {
    expect(PROJECTION.recompile.recompiled).toBe(AFFECTED_COUNT);
    expect(PROJECTION.recompile.worldUnitsTotal).toBe(WORLD_UNITS.length);
    expect(PROJECTION.recompile.inherited).toBe(WORLD_UNITS.length - AFFECTED_COUNT);
  });

  it("keeps proper nouns out of the first 14.5 seconds", () => {
    const early = FEED.filter((r) => r.at < 14.5).map((r) => r.object).join(" ");
    for (const banned of ["Atlas", "Alice", "November"]) {
      expect(early).not.toContain(banned);
    }
  });

  it("orders the feed monotonically so replay never rewinds an event", () => {
    for (let i = 1; i < FEED.length; i += 1) {
      expect(FEED[i].at).toBeGreaterThanOrEqual(FEED[i - 1].at);
    }
  });

  it("splits discovered files across groups without inventing or losing one", () => {
    const share = SOURCE_GROUPS.reduce((a, g) => a + g.share, 0);
    expect(share).toBeCloseTo(1, 10);
    for (const total of [0, 1, 7, 4213, PROJECTION.discovery.filesDiscovered]) {
      const parts = groupCounts(total);
      expect(parts).toHaveLength(SOURCE_GROUPS.length);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      for (const n of parts) expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives the groups different sizes, so the rail is a world and not a placeholder", () => {
    const parts = groupCounts(PROJECTION.discovery.filesDiscovered);
    expect(new Set(parts).size).toBe(parts.length);
  });

  it("runs the compiler rail through six stages inside the timelapse", () => {
    expect(RAIL_STAGES).toHaveLength(6);
    expect(RAIL_STAGES[0].from).toBeGreaterThanOrEqual(0);
    expect(RAIL_STAGES[RAIL_STAGES.length - 1].to).toBeLessThanOrEqual(14.5);
    for (let i = 1; i < RAIL_STAGES.length; i += 1) {
      expect(RAIL_STAGES[i].from).toBeGreaterThanOrEqual(RAIL_STAGES[i - 1].from);
    }
  });
});
