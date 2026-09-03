import type { WorldReadModel } from "./world-read-model";

/*
  What changed between two versions of a World.

  The Versions lens used to list versions. That is a history, not a diff, and it answers the
  wrong question: someone about to roll back does not want to know that four versions exist,
  they want to know what they are about to undo. Masterplan 11 asks for that comparison across
  objects, properties, relations, evidence, review decisions and source revisions, and asks for
  it *before* the rollback rather than as a record of one.

  Everything here is derived from two compiled read models. Nothing is inferred: an object that
  appears in one and not the other is added or removed, a field that differs is changed, and a
  field neither model carries is absent from the diff rather than reported as unchanged.
*/

export type FieldChange = { field: string; before: string; after: string };

export type ObjectDiff = {
  id: string;
  label: string;
  type: string;
  changes: FieldChange[];
};

export type RelationDiff = {
  id: string;
  predicate: string;
  subject: string;
  object: string;
  changes: FieldChange[];
};

export type EvidenceDiff = {
  id: string;
  sourceId: string;
  page: number;
  changes: FieldChange[];
};

export type WorldVersionDiff = {
  left: { manifestDigest: string; status: string };
  right: { manifestDigest: string; status: string };
  identical: boolean;
  objects: { added: ObjectDiff[]; removed: ObjectDiff[]; changed: ObjectDiff[] };
  relations: { added: RelationDiff[]; removed: RelationDiff[]; changed: RelationDiff[] };
  evidence: { added: EvidenceDiff[]; removed: EvidenceDiff[]; changed: EvidenceDiff[] };
  /** Package files by path, compared on digest. */
  files: { added: string[]; removed: string[]; changed: string[] };
  /** Source document versions each side was compiled from. */
  sourceRevisions: { added: string[]; removed: string[]; unchanged: number };
};

function changesBetween(
  before: Record<string, string>,
  after: Record<string, string>,
): FieldChange[] {
  return Object.keys({ ...before, ...after })
    .sort()
    .flatMap((field) => (before[field] === after[field]
      ? []
      : [{ field, before: before[field] ?? "", after: after[field] ?? "" }]));
}

/*
  Which fields of an object are compared.

  Deliberately not "everything on the type". `status` flips from candidate to active when a
  version is promoted, which is a fact about the version and not a change to the object, and
  reporting it would fill every diff with noise that hides the one line that matters.
*/
function objectFields(object: WorldReadModel["objects"][number]): Record<string, string> {
  return {
    label: object.label,
    type: object.type,
    evidence: String(object.evidenceRefs.length),
    relations: String(object.relations.length),
  };
}

function relationFields(relation: WorldReadModel["relations"][number]): Record<string, string> {
  return {
    predicate: relation.predicate,
    subject: relation.subject,
    object: relation.object,
    evidence: String(relation.evidenceRefs.length),
  };
}

/*
  Evidence is compared on its geometry and its digest, not on its excerpt alone.

  A page or a box that moved while the text stayed the same is the more dangerous change: the
  quote still reads correctly and no longer points at where it came from.
*/
function evidenceFields(evidence: WorldReadModel["evidence"][number]): Record<string, string> {
  return {
    page: String(evidence.page),
    bbox: evidence.bbox.join(","),
    digest: evidence.digest,
    sourceVersion: evidence.sourceVersionId,
    excerpt: evidence.excerpt,
  };
}

function partition<T extends { id: string }>(
  left: readonly T[],
  right: readonly T[],
  fields: (item: T) => Record<string, string>,
) {
  const byIdLeft = new Map(left.map((item) => [item.id, item] as const));
  const byIdRight = new Map(right.map((item) => [item.id, item] as const));
  const added = right.filter((item) => !byIdLeft.has(item.id));
  const removed = left.filter((item) => !byIdRight.has(item.id));
  const changed = right.flatMap((item) => {
    const previous = byIdLeft.get(item.id);
    if (!previous) return [];
    const changes = changesBetween(fields(previous), fields(item));
    return changes.length > 0 ? [{ item, changes }] : [];
  });
  return { added, removed, changed };
}

export function diffWorldVersions(left: WorldReadModel, right: WorldReadModel): WorldVersionDiff {
  const objects = partition(left.objects, right.objects, objectFields);
  const relations = partition(left.relations, right.relations, relationFields);
  const evidence = partition(left.evidence, right.evidence, evidenceFields);

  const leftFiles = new Map(left.files.map((file) => [file.path, file.sha256] as const));
  const rightFiles = new Map(right.files.map((file) => [file.path, file.sha256] as const));
  const files = {
    added: [...rightFiles.keys()].filter((path) => !leftFiles.has(path)).sort(),
    removed: [...leftFiles.keys()].filter((path) => !rightFiles.has(path)).sort(),
    changed: [...rightFiles.keys()]
      .filter((path) => leftFiles.has(path) && leftFiles.get(path) !== rightFiles.get(path))
      .sort(),
  };

  const leftRevisions = new Set(left.objects.flatMap((object) => object.sourceVersions));
  const rightRevisions = new Set(right.objects.flatMap((object) => object.sourceVersions));
  const sourceRevisions = {
    added: [...rightRevisions].filter((revision) => !leftRevisions.has(revision)).sort(),
    removed: [...leftRevisions].filter((revision) => !rightRevisions.has(revision)).sort(),
    unchanged: [...rightRevisions].filter((revision) => leftRevisions.has(revision)).length,
  };

  const asObject = (item: WorldReadModel["objects"][number], changes: FieldChange[] = []): ObjectDiff =>
    ({ id: item.id, label: item.label, type: item.type, changes });
  const asRelation = (item: WorldReadModel["relations"][number], changes: FieldChange[] = []): RelationDiff =>
    ({ id: item.id, predicate: item.predicate, subject: item.subject, object: item.object, changes });
  const asEvidence = (item: WorldReadModel["evidence"][number], changes: FieldChange[] = []): EvidenceDiff =>
    ({ id: item.id, sourceId: item.sourceId, page: item.page, changes });

  const result: WorldVersionDiff = {
    left: { manifestDigest: left.world.manifestDigest, status: left.world.status },
    right: { manifestDigest: right.world.manifestDigest, status: right.world.status },
    identical: false,
    objects: {
      added: objects.added.map((item) => asObject(item)),
      removed: objects.removed.map((item) => asObject(item)),
      changed: objects.changed.map((entry) => asObject(entry.item, entry.changes)),
    },
    relations: {
      added: relations.added.map((item) => asRelation(item)),
      removed: relations.removed.map((item) => asRelation(item)),
      changed: relations.changed.map((entry) => asRelation(entry.item, entry.changes)),
    },
    evidence: {
      added: evidence.added.map((item) => asEvidence(item)),
      removed: evidence.removed.map((item) => asEvidence(item)),
      changed: evidence.changed.map((entry) => asEvidence(entry.item, entry.changes)),
    },
    files,
    sourceRevisions,
  };

  result.identical = countChanges(result) === 0;
  return result;
}

/** How much this diff actually says, for the one-line summary above it. */
export function countChanges(diff: WorldVersionDiff) {
  return diff.objects.added.length + diff.objects.removed.length + diff.objects.changed.length
    + diff.relations.added.length + diff.relations.removed.length + diff.relations.changed.length
    + diff.evidence.added.length + diff.evidence.removed.length + diff.evidence.changed.length
    + diff.files.added.length + diff.files.removed.length + diff.files.changed.length
    + diff.sourceRevisions.added.length + diff.sourceRevisions.removed.length;
}
