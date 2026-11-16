import type { WorldHistoryEntry, WorldReadModel } from "./world-read-model";

/*
  The honest time axes of a World: the manifest versions it was activated as, and the source
  revisions its evidence came from. Per-object dates are not recorded in any compiled
  artifact, so there is deliberately no date filter here.
*/
export type VersionOption = WorldHistoryEntry & { current: boolean };

/**
  Newest first, the current one marked. Order of `history` is preserved as given by the model (newest first).
  `viewing` is the version on screen when the current history does not list it (a shared link); it is
  appended so the select names what is shown instead of silently pointing at another version.
*/
export function versionOptions(history: WorldHistoryEntry[], currentDigest: string, viewing?: WorldHistoryEntry | null): VersionOption[] {
  const listed = viewing && !history.some((entry) => entry.manifestDigest === viewing.manifestDigest) ? [...history, viewing] : history;
  return listed.map((entry) => ({ ...entry, current: entry.manifestDigest === currentDigest }));
}

/**
  How a fetched version describes itself: its own history entry, read in the same request as its
  content (`buildWorldReadModel` always lists the artifact's own digest). Null when the read does
  not describe that digest -- the caller then prints no version or state, never a guessed one.
*/
export function viewedVersionEntry(read: WorldReadModel | null, digest: string): WorldHistoryEntry | null {
  return read?.history.find((entry) => entry.manifestDigest === digest) ?? null;
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
