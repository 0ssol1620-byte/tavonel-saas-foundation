import { describe, expect, it } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";
import { buildWorldReadModel, type WorldHistoryEntry } from "./world-read-model";
import type { WorldVersionRow } from "./world-store";
import { datesRecorded, filterBySourceRevision, listedVersion, sourceRevisions, versionOptions } from "./world-temporal-view";

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

  // A shared link can name a version the current World's history does not list: the versions list is
  // capped at 50 (lib/world-store.ts), so an old superseded version falls off it. A read of that version
  // carries only the entry buildWorldReadModel synthesizes ("candidate"), never its real status, so the
  // version is not available: no entry, no option, the current World stays on screen.
  it("a stale link to a version outside the current history is not available, and is never offered", () => {
    const build = (text: string, ws: string, context: Parameters<typeof buildWorldReadModel>[2]) => {
      const compiled = compileCollectionCandidate([input("doc-a", "a".repeat(64), text)]);
      const artifact = { ...compiled, coreExecution: { ...source.coreExecution, worldStateId: ws } };
      return { artifact, read: (ctx = context) => buildWorldReadModel(artifact, artifact.collectionId, ctx)! };
    };
    const row = (digest: string, ws: string, status: WorldVersionRow["lifecycle_status"], i: number): WorldVersionRow => ({
      manifest_digest: digest, world_state_id: ws, lifecycle_status: status,
      first_promoted_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), last_activated_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), activation_count: 1,
    });
    const cur = build("Globex Ltd renewed the Master Services Agreement with Acme Corp.", "ws-cur", {});
    const old = build("Acme Corp signed the Master Services Agreement with Globex Ltd.", "ws-old", {});
    const filler = Array.from({ length: 49 }, (_, i) => row(`sha256:${(i + 16).toString(16).padStart(2, "0").repeat(32)}`, `ws-f${i}`, "superseded", i));
    const ctx = { activeManifestDigest: cur.artifact.manifestDigest, versions: [row(cur.artifact.manifestDigest, "ws-cur", "active", 99), ...filler] };
    const current = cur.read(ctx);
    const asOf = old.artifact.manifestDigest;
    expect(current.history).toHaveLength(50);
    // The past read lists its own digest only as the synthesized default -- exactly what must not be shown.
    expect(old.read(ctx).history.find((e) => e.manifestDigest === asOf)?.status).toBe("candidate");
    expect(listedVersion(current.history, current.world.manifestDigest, asOf)).toBeNull();
    const options = versionOptions(current.history, current.world.manifestDigest);
    expect(options).toHaveLength(50);
    expect(options.some((o) => o.manifestDigest === asOf)).toBe(false);
    // The same version, still listed, is described by its listed row: really superseded, really activated.
    const listedCtx = { ...ctx, versions: [...ctx.versions.slice(0, 49), row(asOf, "ws-old", "superseded", 0)] };
    const entry = listedVersion(cur.read(listedCtx).history, cur.artifact.manifestDigest, asOf);
    expect(entry).toEqual(expect.objectContaining({ version: "ws-old", status: "superseded" }));
    expect(entry?.activatedAt.state).toBe("read");
  });

  it("the current version is not a past version", () => {
    expect(listedVersion(model.history, model.world.manifestDigest, model.world.manifestDigest)).toBeNull();
  });

  // Fuzz: random histories, current digests and requested digests. A version is shown only as an entry
  // the current history holds verbatim; anything else is unavailable, and the select offers exactly the history.
  it("property: only versions the current history lists are ever shown or offered", () => {
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const digests = Array.from({ length: 6 }, (_, i) => `sha256:${String(i).repeat(64)}`);
    const statuses: WorldHistoryEntry["status"][] = ["active", "candidate", "superseded"];
    const entry = (digest: string, i: number): WorldHistoryEntry => ({ version: `ws-${i}`, manifestDigest: digest, status: statuses[rand(3)], activatedAt: model.history[0].activatedAt, activationCount: model.history[0].activationCount });
    for (let run = 0; run < 1000; run += 1) {
      const history = digests.filter(() => rand(2) === 0).map(entry);
      const currentDigest = digests[rand(digests.length)];
      const asOf = digests[rand(digests.length)];
      const found = listedVersion(history, currentDigest, asOf);
      const listed = history.some((e) => e.manifestDigest === asOf);
      if (asOf === currentDigest || !listed) expect(found).toBeNull();
      else {
        expect(history).toContain(found);
        expect(found?.manifestDigest).toBe(asOf);
      }
      const options = versionOptions(history, currentDigest);
      expect(options.map(({ current: marked, ...recorded }) => { expect(marked).toBe(recorded.manifestDigest === currentDigest); return recorded; })).toEqual(history);
      if (!listed) expect(options.some((o) => o.manifestDigest === asOf)).toBe(false);
    }
  });
});
