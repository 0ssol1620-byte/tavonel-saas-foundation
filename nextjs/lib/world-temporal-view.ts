import type { WorldHistoryEntry, WorldReadModel } from "./world-read-model";

/*
  The honest time axes of a World: the manifest versions it was activated as, and the source
  revisions its evidence came from. Per-object dates are not recorded in any compiled
  artifact, so there is deliberately no date filter here.
*/
export type VersionOption = WorldHistoryEntry & { current: boolean };

/** Newest first, the one on screen marked. Order of `history` is preserved as given by the model (newest first). */
export function versionOptions(history: WorldHistoryEntry[], currentDigest: string): VersionOption[] {
  return history.map((entry) => ({ ...entry, current: entry.manifestDigest === currentDigest }));
}

export function sourceRevisions(model: WorldReadModel): string[] {
  return [...new Set(model.objects.flatMap((object) => object.sourceVersions))].sort();
}

export function filterBySourceRevision(model: WorldReadModel, rev: string): WorldReadModel {
  const objects = model.objects.filter((object) => object.sourceVersions.includes(rev));
  const kept = new Set(objects.map((object) => object.id));
  return {
    ...model,
    objects,
    relations: model.relations.filter((relation) => kept.has(relation.subject) && kept.has(relation.object)),
    evidence: model.evidence.filter((item) => item.sourceVersionId === rev),
  };
}

/** False when no object carries a first-seen date, so the page must say so instead of offering a date filter. */
export function datesRecorded(model: WorldReadModel): boolean {
  return model.objects.some((object) => object.firstSeen.state === "read");
}
