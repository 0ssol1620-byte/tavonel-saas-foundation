import { describe, expect, it } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";
import { buildWorldReadModel, type WorldHistoryEntry } from "./world-read-model";
import { datesRecorded, filterBySourceRevision, sourceRevisions, versionOptions, viewedVersionEntry } from "./world-temporal-view";

function input(documentId: string, digest: string, text: string): CollectionOcrInput {
  return {
    documentId, versionKey: digest, pageCount: 1, text, inputSha256: `sha256:${digest}`,
    sanitizedKey: `immutable/ws/ws/documents/${documentId}/${digest}/sanitized.pdf`,
    ocrJsonKey: `immutable/ws/ws/documents/${documentId}/${digest}/ocr.json`,
    sourceImmutableKey: `immutable/ws/ws/documents/${documentId}/${digest}/sanitized.pdf`,
    regions: [{ regionId: `${documentId}-p1-b1`, pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph", text, bbox1000: [80, 120, 920, 320], confidence: 0.99, authority: "contractual" }],
  };
}
const base = compileCollectionCandidate([
  input("doc-a", "a".repeat(64), "Acme Corp signed the Master Services Agreement with Globex Ltd."),
  input("doc-b", "b".repeat(64), "Globex Ltd renewed the Master Services Agreement with Acme Corp."),
]);
const source = { ...base, coreExecution: { status: "completed" as const, runtime: "tavonel-python-core-v2", worldStateId: "ws-1", receipt: { requestId: "t", outputSha256: `sha256:${"c".repeat(64)}`, candidatePromotion: false as const } } };
const model = buildWorldReadModel(source, source.collectionId, { origin: "deterministic_sample" })!;

describe("world temporal view", () => {
  it("keeps only objects, relations and evidence bound to the revision", () => {
    const revs = sourceRevisions(model);
    expect(revs.length).toBeGreaterThan(1);
    const view = filterBySourceRevision(model, revs[0]);
    expect(view.objects.length).toBeGreaterThan(0);
    expect(view.objects.every((o) => o.sourceVersions.includes(revs[0]))).toBe(true);
    const ids = new Set(view.objects.map((o) => o.id));
    expect(view.relations.every((r) => ids.has(r.subject) && ids.has(r.object))).toBe(true);
    expect(view.evidence.every((e) => e.sourceVersionId === revs[0])).toBe(true);
  });

  it("an unknown revision yields an empty view without throwing", () => {
    const view = filterBySourceRevision(model, "no-such-revision");
    expect([view.objects.length, view.relations.length, view.evidence.length]).toEqual([0, 0, 0]);
  });

  it("reports dates as not recorded for a real read model", () => {
    expect(datesRecorded(model)).toBe(false);
  });

  it("marks the current version", () => {
    const options = versionOptions(model.history, model.world.manifestDigest);
    expect(options.filter((o) => o.current)).toHaveLength(1);
    expect(options.find((o) => o.current)?.manifestDigest).toBe(model.world.manifestDigest);
  });

  // A shared link can name a version the current model's history does not list (no active World yet,
  // so the page shows the preferred candidate). The version on screen describes itself from its own read.
  it("describes a viewed version from its own read model, not from the current history", () => {
    const build = (text: string, ws: string) => {
      const compiled = compileCollectionCandidate([input("doc-a", "a".repeat(64), text)]);
      const artifact = { ...compiled, coreExecution: { ...source.coreExecution, worldStateId: ws } };
      return buildWorldReadModel(artifact, artifact.collectionId, { origin: "deterministic_sample" })!;
    };
    const current = build("Globex Ltd renewed the Master Services Agreement with Acme Corp.", "ws-2");
    const past = build("Acme Corp signed the Master Services Agreement with Globex Ltd.", "ws-1");
    const asOf = past.world.manifestDigest;
    expect(current.history.some((entry) => entry.manifestDigest === asOf)).toBe(false);
    expect(viewedVersionEntry(past, asOf)).toEqual(expect.objectContaining({ version: "ws-1", status: "candidate" }));
    const options = versionOptions(current.history, current.world.manifestDigest, viewedVersionEntry(past, asOf));
    expect(options.map((option) => [option.manifestDigest, option.current])).toEqual([[current.world.manifestDigest, true], [asOf, false]]);
  });

  it("returns nothing, never a guessed status, when the read does not describe that digest", () => {
    expect(viewedVersionEntry(model, `sha256:${"f".repeat(64)}`)).toBeNull();
    expect(viewedVersionEntry(null, model.world.manifestDigest)).toBeNull();
  });

  // Fuzz: random histories and digests. Every answer is a record the read holds verbatim, or null;
  // the select offers the digest on screen exactly once and marks only the current one.
  it("property: the viewed entry and the version options only ever repeat recorded data", () => {
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const digests = Array.from({ length: 6 }, (_, i) => `sha256:${String(i).repeat(64)}`);
    const statuses: WorldHistoryEntry["status"][] = ["active", "candidate", "superseded"];
    const entry = (digest: string, i: number): WorldHistoryEntry => ({ version: `ws-${i}`, manifestDigest: digest, status: statuses[rand(3)], activatedAt: model.history[0].activatedAt, activationCount: model.history[0].activationCount });
    const pickHistory = () => digests.filter(() => rand(2) === 0).map(entry);
    for (let run = 0; run < 500; run += 1) {
      const pastHistory = pickHistory();
      const current = pickHistory();
      const currentDigest = digests[rand(digests.length)];
      const asOf = digests[rand(digests.length)];
      const read = rand(5) === 0 ? null : { ...model, history: pastHistory };
      const found = viewedVersionEntry(read, asOf);
      if (found === null) expect(read?.history.some((e) => e.manifestDigest === asOf) ?? false).toBe(false);
      else expect(read?.history).toContain(found);
      const options = versionOptions(current, currentDigest, found);
      expect(options.filter((o) => o.current).every((o) => o.manifestDigest === currentDigest)).toBe(true);
      expect(new Set(options.map((o) => o.manifestDigest)).size).toBe(options.length);
      if (found) expect(options.filter((o) => o.manifestDigest === asOf)).toHaveLength(1);
      for (const { current: marked, ...recorded } of options) {
        expect(marked).toBe(recorded.manifestDigest === currentDigest);
        expect([...current, ...(found ? [found] : [])]).toContainEqual(recorded);
      }
    }
  });
});
