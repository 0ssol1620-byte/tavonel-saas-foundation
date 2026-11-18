/*
  The blueprint a compile may ask Core for (WO-C-C1, E-9).

  The ids are the seven `BlueprintId` literals the live Core release accepts (`contracts.py` at
  AKC 6b3a27bf, digest a37d19b6; measured in receipts/WO-E-CORE-0/LINEAGE.md). `creative-works`
  and `team-workspace` are refused by that release with 422 CORE_REQUEST_INVALID, so they are not
  here: they join this list in the commit that ships a Core release carrying them, not before.

  "generic" is a choice, not a Core id. It means the field is not sent and Core picks by itself.
  Any other string is refused here; a refused value is never sent and never replaced.
*/
export const CORE_BLUEPRINT_IDS = [
  "corporate-filings",
  "course-materials",
  "generic-mixed-corpus",
  "legal-contracts",
  "personal-knowledge",
  "research-library",
  "technical-documentation",
] as const;

export type CoreBlueprintId = (typeof CORE_BLUEPRINT_IDS)[number];

export function isCoreBlueprintId(value: unknown): value is CoreBlueprintId {
  return typeof value === "string" && (CORE_BLUEPRINT_IDS as readonly string[]).includes(value);
}

export type BlueprintChoice = { ok: true; blueprint: CoreBlueprintId | undefined } | { ok: false; code: "BLUEPRINT_UNSUPPORTED" };

/** `undefined`/`"generic"` -> do not send; one of the seven ids -> send it; anything else -> refuse. */
export function readBlueprintChoice(value: unknown): BlueprintChoice {
  if (value === undefined || value === "generic") return { ok: true, blueprint: undefined };
  return isCoreBlueprintId(value) ? { ok: true, blueprint: value } : { ok: false, code: "BLUEPRINT_UNSUPPORTED" };
}
