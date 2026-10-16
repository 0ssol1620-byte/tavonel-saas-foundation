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

/*
  A compared field is a plain value, or a reference list read as a set ("members") or as the size
  of that set ("count"). Lists are kept as lists until they are known to differ: the sorted JSON a
  change prints is built only for a field that changed. Building it for every object made the
  sample's five-snapshot timeline sort and serialise 1.1M evidence ids per World, and a diff that
  took about 40 ms took seconds.
*/
type FieldValue = string | { members: readonly string[] } | { count: readonly string[] };
type Fields = Record<string, FieldValue>;

function listOf(value: Exclude<FieldValue, string>) {
  return "members" in value ? value.members : value.count;
}

// ponytail: cached by list identity, because a read model is never mutated once built; a caller
// that edits a list in place after diffing it would read the stale canonical form.
const canonicalByList = new WeakMap<readonly string[], { json: string; size: number }>();

function canonical(ids: readonly string[]) {
  let cached = canonicalByList.get(ids);
  if (!cached) {
    const sorted = membership(ids);
    cached = { json: JSON.stringify(sorted), size: sorted.length };
    canonicalByList.set(ids, cached);
  }
  return cached;
}

function render(value: FieldValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return "members" in value ? canonical(value.members).json : String(canonical(value.count).size);
}

function sameValue(before: FieldValue | undefined, after: FieldValue | undefined) {
  if (before === undefined || after === undefined || typeof before === "string" || typeof after === "string") {
    return before === after;
  }
  if (("members" in before) !== ("members" in after)) return false;
  const left = listOf(before);
  const right = listOf(after);
  // An unchanged object holds the same ids in the same order: one pass, nothing allocated.
  if (left.length === right.length && left.every((id, index) => id === right[index])) return true;
  return render(before) === render(after);
}

function changesBetween(before: Fields, after: Fields): FieldChange[] {
  return Object.keys({ ...before, ...after })
    .sort()
    .flatMap((field) => (sameValue(before[field], after[field])
      ? []
      : [{ field, before: render(before[field]), after: render(after[field]) }]));
}

/*
  Reference lists are sets, and are compared as sets.

  Comparing only their length let a same-sized replacement through: an object whose one
  evidence reference was swapped for another reported no change, and two objects that traded
  source versions hid behind a global revision set that had not moved. The membership itself is
  compared now, as JSON of the sorted unique ids, so before and after read unambiguously. Order
  and repetition carry no meaning here and so cannot produce a change. The ids are copied before
  sorting and are never trimmed or normalised: two ids that differ by a byte are two ids.
*/
function membership(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/*
  Which fields of an object are compared.

  Deliberately not "everything on the type". `status` flips from candidate to active when a
  version is promoted, which is a fact about the version and not a change to the object, and
  reporting it would fill every diff with noise that hides the one line that matters. Aliases
  and first-seen/last-changed history are read values the compiled artifact does not yet carry,
  and stay out of the comparison for the same reason they are absent from the model.
*/
function objectFields(object: WorldReadModel["objects"][number]): Fields {
  return {
    label: object.label,
    type: object.type,
    evidence: { count: object.evidenceRefs },
    relations: { count: object.relations },
    evidenceRefs: { members: object.evidenceRefs },
    relationRefs: { members: object.relations },
    claims: { members: object.claims },
    sourceVersions: { members: object.sourceVersions },
  };
}

function relationFields(relation: WorldReadModel["relations"][number]): Fields {
  return {
    predicate: relation.predicate,
    subject: relation.subject,
    object: relation.object,
    evidence: { count: relation.evidenceRefs },
    evidenceRefs: { members: relation.evidenceRefs },
  };
}

/*
  Evidence is compared on its geometry and its digest, not on its excerpt alone.

  A page or a box that moved while the text stayed the same is the more dangerous change: the
  quote still reads correctly and no longer points at where it came from.
*/
function evidenceFields(evidence: WorldReadModel["evidence"][number]): Fields {
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
  fields: (item: T) => Fields,
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
