import type { WorldHistoryEntry, WorldReadModel } from "./world-read-model";
import { countChanges, type WorldVersionDiff } from "./world-version-diff";

/*
  What changed in this workspace, read from the World's own history.

  A Change Inbox is the one surface where a fabricated number does the most damage: a row that
  says "4 affected claims" is an assertion about somebody's knowledge base, and it has to come
  from comparing two compiled artifacts rather than from a plausible-looking guess. Nothing in
  this module invents a count. Every number below is derived from `diffWorldVersions`, which is
  itself derived from two read models the API returned; when a version cannot be read, the
  caller is told that instead of being shown a zero.

  The history the World reports is newest-first (`last_activated_at desc`, with an unactivated
  candidate unshifted at the front). A change record is therefore a consecutive pair in that
  list: `history[i + 1]` is what the World was, `history[i]` is what it became.
*/

export type ChangeTransition = {
  /** Stable across renders: the two digests are what identifies the comparison. */
  id: string;
  before: WorldHistoryEntry;
  after: WorldHistoryEntry;
};

export type ChangeInboxReading =
  /** No World has been compiled in this workspace yet. */
  | { state: "not_yet"; reason: string }
  /** A World exists but its read model could not be loaded, so nothing can be compared. */
  | { state: "unavailable"; reason: string }
  /** Exactly one version exists. A first compile is not a change. */
  | { state: "single"; reason: string; history: WorldHistoryEntry[] }
  | { state: "read"; transitions: ChangeTransition[]; history: WorldHistoryEntry[] };

export function listChangeTransitions(history: readonly WorldHistoryEntry[]): ChangeTransition[] {
  return history.slice(0, -1).map((after, index) => {
    const before = history[index + 1];
    return { id: `${before.manifestDigest}->${after.manifestDigest}`, before, after };
  });
}

/**
 * What the Changes surface may say, given what the page actually holds.
 *
 * `collectionId` is the distinction the read model cannot make on its own: a null model means
 * "no World has been compiled" when no collection is loaded and "the World could not be read"
 * when one is. Collapsing the two would report an outage as an empty workspace.
 */
export function readChangeInbox(
  model: WorldReadModel | null,
  collectionId: string | null,
): ChangeInboxReading {
  if (!collectionId) {
    return { state: "not_yet", reason: "Compile a World to see its changes." };
  }
  if (!model) {
    return {
      state: "unavailable",
      reason: "This World's read model could not be loaded, so no version can be compared. Nothing was changed.",
    };
  }
  const history = model.history;
  if (history.length < 2) {
    return {
      state: "single",
      reason: "No change yet. This World has one compiled version, and a first compile is not a change.",
      history,
    };
  }
  return { state: "read", transitions: listChangeTransitions(history), history };
}

export type ChangeGroupCounts = { added: number; removed: number; changed: number };

export type ChangeImpactCounts = {
  objects: ChangeGroupCounts;
  relations: ChangeGroupCounts;
  evidence: ChangeGroupCounts;
  files: ChangeGroupCounts;
  sourceRevisions: { added: number; removed: number; unchanged: number };
  /** The same total the version diff panel prints, so the two surfaces cannot disagree. */
  total: number;
};

export function summariseChangeImpact(diff: WorldVersionDiff): ChangeImpactCounts {
  return {
    objects: {
      added: diff.objects.added.length,
      removed: diff.objects.removed.length,
      changed: diff.objects.changed.length,
    },
    relations: {
      added: diff.relations.added.length,
      removed: diff.relations.removed.length,
      changed: diff.relations.changed.length,
    },
    evidence: {
      added: diff.evidence.added.length,
      removed: diff.evidence.removed.length,
      changed: diff.evidence.changed.length,
    },
    files: {
      added: diff.files.added.length,
      removed: diff.files.removed.length,
      changed: diff.files.changed.length,
    },
    sourceRevisions: {
      added: diff.sourceRevisions.added.length,
      removed: diff.sourceRevisions.removed.length,
      unchanged: diff.sourceRevisions.unchanged,
    },
    total: countChanges(diff),
  };
}

/*
  The source half of the inbox.

  Evidence is where a compiled World touches the document it came from, so a change to an
  evidence region -- its excerpt, its page, its box, its digest, the source version it was read
  from -- is the change a reader can check against the PDF. Only evidence that differs is
  listed; evidence added or removed outright is counted, not quoted, because there is no
  before/after pair to show.
*/
export type SourceDiffLine = {
  evidenceId: string;
  sourceId: string;
  page: number;
  field: string;
  before: string;
  after: string;
};

const SOURCE_FIELD_ORDER = ["excerpt", "page", "bbox", "sourceVersion", "digest"] as const;

export function readSourceDiff(diff: WorldVersionDiff): SourceDiffLine[] {
  return diff.evidence.changed.flatMap((entry) =>
    [...entry.changes]
      .sort((left, right) => fieldRank(left.field) - fieldRank(right.field))
      .map((change) => ({
        evidenceId: entry.id,
        sourceId: entry.sourceId,
        page: entry.page,
        field: change.field,
        before: change.before,
        after: change.after,
      })));
}

function fieldRank(field: string) {
  const index = SOURCE_FIELD_ORDER.indexOf(field as (typeof SOURCE_FIELD_ORDER)[number]);
  return index === -1 ? SOURCE_FIELD_ORDER.length : index;
}

/*
  The knowledge half of the inbox.

  Compiled object and relation ids are internal keys, so they are resolved to the labels the
  compiler gave them. An id that resolves to nothing keeps its id rather than being dropped:
  losing a row would understate the impact, which is the one direction this panel must never
  round in.
*/
export type KnowledgeImpactLine = {
  kind: "object" | "relation";
  id: string;
  label: string;
  type: string;
  effect: "added" | "removed" | "changed";
  /** Which compared fields differ. Empty for an addition or a removal. */
  fields: string[];
};

export function objectLabels(...models: Array<WorldReadModel | null>): Map<string, string> {
  const labels = new Map<string, string>();
  for (const model of models) {
    for (const object of model?.objects ?? []) labels.set(object.id, object.label);
  }
  return labels;
}

export function readKnowledgeImpact(
  diff: WorldVersionDiff,
  labels: Map<string, string>,
): KnowledgeImpactLine[] {
  const name = (id: string) => labels.get(id) ?? id;
  const objects: KnowledgeImpactLine[] = [
    ...diff.objects.changed.map((item) => line("object", item.id, item.label, item.type, "changed", item.changes.map((change) => change.field))),
    ...diff.objects.added.map((item) => line("object", item.id, item.label, item.type, "added", [])),
    ...diff.objects.removed.map((item) => line("object", item.id, item.label, item.type, "removed", [])),
  ];
  const relations: KnowledgeImpactLine[] = [
    ...diff.relations.changed.map((item) => line("relation", item.id, `${name(item.subject)} ${item.predicate} ${name(item.object)}`, item.predicate, "changed", item.changes.map((change) => change.field))),
    ...diff.relations.added.map((item) => line("relation", item.id, `${name(item.subject)} ${item.predicate} ${name(item.object)}`, item.predicate, "added", [])),
    ...diff.relations.removed.map((item) => line("relation", item.id, `${name(item.subject)} ${item.predicate} ${name(item.object)}`, item.predicate, "removed", [])),
  ];
  return [...objects, ...relations];
}

function line(
  kind: KnowledgeImpactLine["kind"],
  id: string,
  label: string,
  type: string,
  effect: KnowledgeImpactLine["effect"],
  fields: string[],
): KnowledgeImpactLine {
  return { kind, id, label, type, effect, fields };
}

/**
 * The one-line summary above a transition. Plural forms only; no number is rounded or omitted.
 */
export function describeChangeImpact(counts: ChangeImpactCounts): string {
  if (counts.total === 0) return "No difference between these two compiled versions.";
  const parts = [
    describeGroup("object", counts.objects),
    describeGroup("relation", counts.relations),
    describeGroup("evidence region", counts.evidence),
    describeGroup("package file", counts.files),
  ].filter((part): part is string => part !== null);
  const revisions = counts.sourceRevisions.added + counts.sourceRevisions.removed;
  if (revisions > 0) parts.push(`${revisions} source revision${revisions === 1 ? "" : "s"} added or removed`);
  return parts.join(" · ");
}

function describeGroup(noun: string, group: ChangeGroupCounts): string | null {
  const total = group.added + group.removed + group.changed;
  if (total === 0) return null;
  const detail = [
    group.changed > 0 ? `${group.changed} changed` : null,
    group.added > 0 ? `${group.added} added` : null,
    group.removed > 0 ? `${group.removed} removed` : null,
  ].filter((part): part is string => part !== null).join(", ");
  return `${total} ${noun}${total === 1 ? "" : "s"} (${detail})`;
}

/**
 * A pair-only view of a World, so the existing version-diff panel opens on the transition the
 * reader picked rather than on its own default.
 *
 * `after` is the read model of `transition.after` -- the newer side, as the versioned endpoint
 * returned it. Its objects, relations, evidence and files pass through untouched. Only
 * `history` is narrowed, to the two entries of this pair -- both of them entries
 * the World itself reported. The panel selects the first entry that is not the one on screen,
 * which is then necessarily the older side of this transition. Nothing is invented: a list is
 * narrowed to the comparison the reader asked for.
 */
export function pairScopedModel(after: WorldReadModel, transition: ChangeTransition): WorldReadModel {
  return { ...after, history: [transition.after, transition.before] };
}
