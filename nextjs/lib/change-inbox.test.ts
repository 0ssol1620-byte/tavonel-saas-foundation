import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCandidatePatch } from "./collection-patch";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";
import { buildWorldReadModel, type WorldHistoryEntry, type WorldReadModel } from "./world-read-model";
import { countChanges, diffWorldVersions } from "./world-version-diff";
import {
  describeChangeImpact,
  listChangeTransitions,
  objectLabels,
  pairScopedModel,
  readChangeInbox,
  readKnowledgeImpact,
  readSourceDiff,
  summariseChangeImpact,
} from "./change-inbox";

/*
  The Change Inbox is tested against two versions that were really compiled, not against a
  hand-written diff. The correction below is the same one the version-diff test uses: a
  reviewer fixes a misread company name, a second candidate artifact is produced, and the
  inbox has to describe what that did without inventing anything.
*/

function input(documentId: string, digest: string, text: string): CollectionOcrInput {
  return {
    documentId,
    versionKey: digest,
    sanitizedKey: `immutable/ws/ws/documents/${documentId}/${digest}/sanitized.pdf`,
    ocrJsonKey: `immutable/ws/ws/documents/${documentId}/${digest}/ocr.json`,
    pageCount: 1,
    text,
    inputSha256: `sha256:${digest}`,
    sourceImmutableKey: `immutable/ws/ws/documents/${documentId}/${digest}/sanitized.pdf`,
    regions: [{
      regionId: `${documentId}-p1-b1`,
      pageIndex0: 0,
      pageNumber1: 1,
      order: 0,
      blockType: "paragraph",
      text,
      bbox1000: [80, 120, 920, 320],
      confidence: 0.99,
      authority: "contractual",
    }],
  };
}

function withCore(base: ReturnType<typeof compileCollectionCandidate>) {
  return {
    ...base,
    coreExecution: {
      status: "completed" as const,
      runtime: "tavonel-python-core-v2",
      worldStateId: "world-state-1",
      receipt: { requestId: "change-inbox-test", outputSha256: `sha256:${"c".repeat(64)}`, candidatePromotion: false as const },
    },
  };
}

const original = withCore(compileCollectionCandidate([
  input("contract-a", "a".repeat(64), "ACME Corporaton shall pay every valid invoice within 30 calendar days."),
]));

const entity = original.ontology.nodes.find((node) => node.kind === "Entity")!;
const patched = (() => {
  const result = applyCandidatePatch(
    original,
    { objectId: entity.id, before: entity.label, after: "ACME Corporation" },
    { evidenceId: "e1", actorUserId: "11111111-1111-4111-8111-111111111111", patchedAt: "2026-09-03T00:00:00.000Z" },
  );
  if (!result.ok) throw new Error(result.code);
  return result.artifact;
})();

const before = buildWorldReadModel(original, original.collectionId, { origin: "deterministic_sample" })!;
const after = buildWorldReadModel(patched, original.collectionId, { origin: "deterministic_sample" })!;

function entry(version: string, digest: string, status: WorldHistoryEntry["status"], activatedAt: string): WorldHistoryEntry {
  return {
    version,
    manifestDigest: digest,
    status,
    activatedAt: { state: "read", value: activatedAt },
    activationCount: { state: "read", value: 1 },
  };
}

const HISTORY: WorldHistoryEntry[] = [
  entry("world-state-3", `sha256:${"3".repeat(64)}`, "active", "2026-09-03T00:00:00.000Z"),
  entry("world-state-2", `sha256:${"2".repeat(64)}`, "superseded", "2026-09-02T00:00:00.000Z"),
  entry("world-state-1", `sha256:${"1".repeat(64)}`, "superseded", "2026-09-01T00:00:00.000Z"),
];

function withHistory(history: WorldHistoryEntry[]): WorldReadModel {
  return { ...after, history };
}

describe("what the Changes surface is allowed to say", () => {
  it("asks for a compile when no World has been compiled", () => {
    const reading = readChangeInbox(null, null);
    expect(reading.state).toBe("not_yet");
    expect(reading.state === "not_yet" && reading.reason).toBe("Compile a World to see its changes.");
  });

  it("separates a workspace with no World from a World it could not read", () => {
    const reading = readChangeInbox(null, original.collectionId);
    expect(reading.state).toBe("unavailable");
    // The distinction exists so an outage is never drawn as an empty workspace.
    expect(reading.state === "unavailable" && reading.reason).toContain("could not be loaded");
  });

  it("does not call a first compile a change", () => {
    const reading = readChangeInbox(withHistory([HISTORY[2]]), original.collectionId);
    expect(reading.state).toBe("single");
    expect(reading.state === "single" && reading.reason).toContain("a first compile is not a change");
    expect(reading.state === "single" && reading.history).toHaveLength(1);
  });

  it("reads consecutive versions as change records, newest first", () => {
    const reading = readChangeInbox(withHistory(HISTORY), original.collectionId);
    expect(reading.state).toBe("read");
    if (reading.state !== "read") throw new Error("expected a readable inbox");
    expect(reading.transitions).toHaveLength(2);
    expect(reading.transitions[0].before.version).toBe("world-state-2");
    expect(reading.transitions[0].after.version).toBe("world-state-3");
    expect(reading.transitions[1].before.version).toBe("world-state-1");
    expect(reading.transitions[1].after.version).toBe("world-state-2");
  });

  it("gives a transition an id that identifies the two artifacts compared", () => {
    const [newest] = listChangeTransitions(HISTORY);
    expect(newest.id).toBe(`${HISTORY[1].manifestDigest}->${HISTORY[0].manifestDigest}`);
  });

  it("has no change record for an empty history", () => {
    expect(listChangeTransitions([])).toEqual([]);
  });
});

describe("counts derived from two compiled versions", () => {
  const diff = diffWorldVersions(before, after);
  const counts = summariseChangeImpact(diff);

  it("counts exactly what the diff holds", () => {
    expect(counts.objects).toEqual({
      added: diff.objects.added.length,
      removed: diff.objects.removed.length,
      changed: diff.objects.changed.length,
    });
    expect(counts.objects.changed).toBe(1);
    expect(counts.relations).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(counts.evidence).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(counts.files.changed).toBe(diff.files.changed.length);
  });

  it("agrees with the total the version diff panel prints", () => {
    expect(counts.total).toBe(countChanges(diff));
  });

  it("says nothing changed when nothing changed", () => {
    const identical = summariseChangeImpact(diffWorldVersions(after, after));
    expect(identical.total).toBe(0);
    expect(describeChangeImpact(identical)).toBe("No difference between these two compiled versions.");
  });

  it("describes the change with the numbers it derived, and no others", () => {
    const sentence = describeChangeImpact(counts);
    expect(sentence).toContain("1 object (1 changed)");
    expect(sentence).toContain(`${counts.files.changed} package files (${counts.files.changed} changed)`);
    // A correction touches no evidence and no relation, so neither is mentioned at all.
    expect(sentence).not.toContain("relation");
    expect(sentence).not.toContain("evidence region");
  });
});

describe("the two halves of an impact reading", () => {
  it("shows the source side only when an evidence region really differs", () => {
    expect(readSourceDiff(diffWorldVersions(before, after))).toEqual([]);
  });

  it("reports a moved region as a source difference, with the geometry that moved", () => {
    const moved: WorldReadModel = {
      ...after,
      evidence: after.evidence.map((item, index) => (index === 0
        ? { ...item, bbox: [10, 20, 30, 40] as [number, number, number, number] }
        : item)),
    };
    const lines = readSourceDiff(diffWorldVersions(after, moved));
    const bbox = lines.find((line) => line.field === "bbox");
    expect(bbox).toBeDefined();
    expect(bbox!.before).toBe(after.evidence[0].bbox.join(","));
    expect(bbox!.after).toBe("10,20,30,40");
    expect(bbox!.sourceId).toBe(after.evidence[0].sourceId);
    expect(bbox!.page).toBe(after.evidence[0].page);
  });

  it("puts the excerpt before the digest, because that is the line a reader can check", () => {
    const rewritten: WorldReadModel = {
      ...after,
      evidence: after.evidence.map((item, index) => (index === 0
        ? { ...item, excerpt: `${item.excerpt} (amended)`, digest: `sha256:${"d".repeat(64)}` }
        : item)),
    };
    const fields = readSourceDiff(diffWorldVersions(after, rewritten)).map((line) => line.field);
    expect(fields.indexOf("excerpt")).toBeLessThan(fields.indexOf("digest"));
  });

  it("names the compiled object that changed, and what about it changed", () => {
    const diff = diffWorldVersions(before, after);
    const lines = readKnowledgeImpact(diff, objectLabels(before, after));
    const changed = lines.filter((line) => line.effect === "changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].kind).toBe("object");
    expect(changed[0].label).toBe("ACME Corporation");
    expect(changed[0].fields).toEqual(["label"]);
  });

  it("resolves a relation's endpoints to labels rather than printing internal ids", () => {
    const relation = after.relations[0];
    expect(relation).toBeDefined();
    const dropped: WorldReadModel = { ...after, relations: after.relations.slice(1) };
    const lines = readKnowledgeImpact(diffWorldVersions(after, dropped), objectLabels(after));
    const removed = lines.find((line) => line.kind === "relation" && line.effect === "removed");
    expect(removed).toBeDefined();
    const labels = objectLabels(after);
    expect(removed!.label).toBe(`${labels.get(relation.subject)} ${relation.predicate} ${labels.get(relation.object)}`);
    expect(removed!.label).not.toContain(relation.subject);
  });

  it("keeps an unresolvable id rather than dropping the row", () => {
    const lines = readKnowledgeImpact(
      diffWorldVersions(after, { ...after, relations: after.relations.slice(1) }),
      new Map(),
    );
    expect(lines.filter((line) => line.kind === "relation")).toHaveLength(1);
  });
});

describe("opening the existing comparison panel on one pair", () => {
  const [newest] = listChangeTransitions(HISTORY);
  /*
    What the surface actually holds at this point: the read model the API returned for the
    newer side of the transition. Its own digest is that side's digest, which is what makes
    the panel's default selection land on the older side.
  */
  const newerSide: WorldReadModel = {
    ...after,
    world: { ...after.world, manifestDigest: newest.after.manifestDigest },
    history: HISTORY,
  };
  const scoped = pairScopedModel(newerSide, newest);

  it("narrows the history to the two versions of that transition", () => {
    expect(scoped.history.map((item) => item.manifestDigest)).toEqual([
      newest.after.manifestDigest,
      newest.before.manifestDigest,
    ]);
  });

  it("leaves the compiled content of the newer version untouched", () => {
    expect(scoped.world).toEqual(newerSide.world);
    expect(scoped.objects).toBe(after.objects);
    expect(scoped.evidence).toBe(after.evidence);
    expect(scoped.files).toBe(after.files);
  });

  it("puts the older side first among the panel's comparison candidates", () => {
    // The panel selects the first history entry that is not the one on screen. With the pair
    // narrowed this way, that entry is necessarily the older side of the transition.
    const candidates = scoped.history.filter((item) => item.manifestDigest !== scoped.world.manifestDigest);
    expect(candidates[0].manifestDigest).toBe(newest.before.manifestDigest);
  });
});

describe("where the Change Inbox is wired", () => {
  const shell = readFileSync(new URL("../components/workspace-ultimate-shell.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
  const inbox = readFileSync(new URL("../components/change-inbox.tsx", import.meta.url), "utf8");

  it("is a primary workspace surface, ahead of the secondary group", () => {
    expect(shell).toContain(`{ surface: "changes", label: "Changes"`);
    expect(shell.indexOf(`surface: "changes"`)).toBeGreaterThan(shell.indexOf(`surface: "review"`));
    expect(shell.indexOf(`surface: "changes"`)).toBeLessThan(shell.indexOf(`surface: "connections"`));
  });

  it("does not push a primary surface off the five-slot mobile rail", () => {
    /*
      The mobile rail fills five fixed columns by position. A new row inserted before World
      silently drops Ask from the rail, so the position of this row is load-bearing until the
      slot list stops being positional.
    */
    const rows = [...shell.matchAll(/\{ surface: "(\w+)"/g)].map((match) => match[1]);
    const mobile = [rows[0], rows[1], rows[3], rows[4], rows[rows.length - 1]];
    expect(mobile).toEqual(["home", "sources", "world", "ask", "settings"]);
  });

  it("is rendered from the workspace page with the loaded World and its collection", () => {
    expect(workspace).toContain(`{surface === "changes" ? (`);
    expect(workspace).toContain("<ChangeInbox");
    expect(workspace).toContain("changes: \"workspace-changes\"");
  });

  it("reads the other version from the versioned World endpoint", () => {
    expect(inbox).toContain("?manifest=");
    expect(inbox).toContain("<WorldVersionDiffPanel");
  });
});
