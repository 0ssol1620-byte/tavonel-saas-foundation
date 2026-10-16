import type { WorldOntology } from "./world-read-model";

/*
  A local, unsaved preview of a proposed class name.

  A customer looking at the compiled ontology may want to see what a class would be called
  under a name of their choosing, and what that class touches, before asking for any real
  change. This module answers only that, from the ontology already on screen: the class's own
  instance and evidence counts, and the observed properties that use it as domain or range.

  It does not rename anything. Nothing here writes, persists, migrates, merges or recompiles,
  and the proposed name is a string -- it is not checked as a WorldObjectType or a schema
  class, because no step here could make it one. Every output is read from the input, never
  inferred: no relation count per class (the ontology does not break property uses down by
  class), no object or evidence ids, no hierarchy, no claim or cache effect.

  Class names and observed domain/range entries are compared exactly and case-sensitively:
  they are identifiers the compiler emitted, not paths and not free text.
*/

export const PROPOSED_CLASS_NAME_MAX = 80;

export type ClassRenameRole = "domain" | "range";

export type ClassRenamePropertyUse = {
  name: string;
  /** Always in the order domain, range; a property using the class in both is listed once. */
  roles: ClassRenameRole[];
};

export type ClassRenamePreview = {
  state: "preview";
  sourceClass: string;
  /** Trimmed. A proposal string only -- not a validated class type. */
  proposedName: string;
  instances: number;
  withEvidence: number;
  /** Unique property names, sorted by code unit so two renders agree. */
  properties: ClassRenamePropertyUse[];
  /** Plain-language limits of this particular preview, in display order. */
  notes: string[];
};

export type ClassRenameRefusalReason =
  | "no_ontology"
  | "no_classes"
  | "unknown_class"
  | "empty_name"
  | "too_long"
  | "control_character"
  | "unchanged"
  | "collides_with_existing_class";

export type ClassRenameRefusal = {
  state: "refused";
  reason: ClassRenameRefusalReason;
  message: string;
};

export type ClassRenameOutcome = ClassRenamePreview | ClassRenameRefusal;

/*
  Control characters, line and paragraph separators, and the bidirectional embedding, override
  and isolate controls -- the last group because they can make a label read differently from
  the characters it holds. Joiners (U+200C, U+200D) stay allowed: scripts and emoji need them.
*/
const DISALLOWED = /[\p{Cc}\p{Zl}\p{Zp}‪-‮⁦-⁩]/u;

const byCodeUnit = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function refuse(reason: ClassRenameRefusalReason, message: string): ClassRenameRefusal {
  return { state: "refused", reason, message };
}

/**
 * Compute a local class-name preview, or the plain reason one cannot be shown.
 *
 * Pure: reads `ontology` and returns new values; the input is never mutated.
 */
export function previewClassRename(
  ontology: WorldOntology | null | undefined,
  sourceClass: string,
  proposedName: string,
): ClassRenameOutcome {
  if (!ontology) return refuse("no_ontology", "There is no compiled ontology to preview a name against.");
  if (ontology.classes.length === 0) return refuse("no_classes", "This World has no compiled classes to propose a name for.");

  const source = ontology.classes.find((entry) => entry.name === sourceClass);
  if (!source) return refuse("unknown_class", "Choose a class from this compiled ontology.");

  const name = proposedName.trim();
  // Counted in code points, so a name in a non-Latin script is not charged for its encoding.
  const length = Array.from(name).length;
  if (length === 0) return refuse("empty_name", "Enter a proposed name.");
  if (length > PROPOSED_CLASS_NAME_MAX) {
    return refuse("too_long", `Use ${PROPOSED_CLASS_NAME_MAX} characters or fewer (this name has ${length}).`);
  }
  if (DISALLOWED.test(name)) return refuse("control_character", "Remove line breaks, tabs and other control characters.");
  if (name === source.name) return refuse("unchanged", "That is already this class's name. Enter a different one.");
  if (ontology.classes.some((entry) => entry.name === name)) {
    return refuse("collides_with_existing_class", `${name} is already the name of another class in this World.`);
  }

  // One entry per property name, however many times the input lists it, so a property that
  // uses the class as both domain and range -- or appears twice -- is counted once.
  const roles = new Map<string, Set<ClassRenameRole>>();
  for (const property of ontology.properties) {
    const inDomain = property.domain.includes(source.name);
    const inRange = property.range.includes(source.name);
    if (!inDomain && !inRange) continue;
    const seen = roles.get(property.name) ?? new Set<ClassRenameRole>();
    if (inDomain) seen.add("domain");
    if (inRange) seen.add("range");
    roles.set(property.name, seen);
  }
  const properties = [...roles.keys()].sort(byCodeUnit).map((propertyName) => {
    const seen = roles.get(propertyName)!;
    return {
      name: propertyName,
      roles: (["domain", "range"] as const).filter((role) => seen.has(role)),
    };
  });

  const notes = [
    "Preview only: nothing has been renamed or saved. The compiled World, its claims, caches, relations and export files are unchanged.",
    "The proposed name is a label for discussion. It is not checked as a class type and implies no schema change or migration.",
    "Counts come from this compiled ontology. Domain and range are what this World used, not declared constraints, and property uses are not split by class, so no relation count is shown.",
  ];
  if (source.instances === 0) notes.push("No instances of this class are compiled in this World.");
  if (properties.length === 0) notes.push("No observed property has this class as its domain or range.");

  return {
    state: "preview",
    sourceClass: source.name,
    proposedName: name,
    instances: source.instances,
    withEvidence: source.withEvidence,
    properties,
    notes,
  };
}

/**
 * A content key for the ontology a draft was made against.
 *
 * The viewer keys the draft by this, so a draft does not outlive the classes, properties,
 * hierarchy status or exports it was written for. It is derived from content only: it is not
 * a World version, it is not persisted, and nothing should treat it as an identity.
 */
export function ontologyPreviewSnapshotKey(ontology: WorldOntology | null | undefined): string {
  if (!ontology) return "ontology:none";
  return JSON.stringify({
    classes: ontology.classes.map((entry) => [entry.name, entry.instances, entry.withEvidence]),
    properties: ontology.properties.map((entry) => [entry.name, entry.usages, entry.withEvidence, entry.domain, entry.range]),
    hierarchy: ontology.hierarchy.state === "not_yet" ? ["not_yet", ontology.hierarchy.reason] : ["read"],
    exports: ontology.exports.map((file) => [file.path, file.mediaType, file.sha256]),
  });
}
