/**
 * The recipe a reader picked, carried across a sign-in.
 *
 * `checkout-intent.ts` already solved this shape for one thing a visitor can declare -- an offer
 * code -- and the reasoning there applies verbatim here: the URL makes the intent linkable and
 * visible, `sessionStorage` is the only thing that survives the fixed OAuth callback path, and it
 * is cleared the moment it is consumed. This module is the second instance of that pattern, not a
 * generalisation of it: `checkout-intent.ts` is untouched and still owns the purchase hop.
 *
 * What travels is three fields and nothing else:
 *
 *   recipeId        one of the six cookbook slugs, and never a free string
 *   recipeVersion   the shape of the recipe the reader actually read
 *   returnTo        a path from a closed allow-list, so it cannot be an origin
 *
 * No workspace id, no plan, no price, no page count. A URL a reader can edit must not be able to
 * name any of those, and the entitlement a signed-in account actually has is resolved from the
 * server's own catalog after sign-in -- `recipeId` is a content reference, not a capability
 * grant. `parseRecipeIntent` is the one validator, it rebuilds the object from the three known
 * keys rather than trusting the input's shape, and both sides of the sign-in call it: the client
 * before it stores anything, and any server that is handed the carried value.
 *
 * `recipeVersion` exists for the deploy in the middle of a sign-in. A reader who started from a
 * cookbook written against one recipe shape and came back after it changed is resumed into copy
 * they never read; a version that no longer matches is refused, which returns them to the
 * cookbook instead of into a stale flow.
 *
 * The second half of this file is first-touch attribution, and it is here because the one bug
 * worth preventing is the two of them being written to the same record. Internal movement --
 * which cookbook, which recipe -- is the intent above. Where the reader came from is the
 * attribution below. They are separate keys, the internal writer never touches the attribution
 * record, and first touch wins: a reader who arrives from a campaign, reads three pages and then
 * starts a recipe keeps the campaign, because overwriting it with the last internal hop is how
 * attribution reports every conversion as "direct".
 */

import { COOKBOOK_SLUGS, RECIPE_VERSION as COOKBOOK_RECIPE_VERSION } from "@/lib/cookbook-slugs";

/** The six cookbook slugs, read from the module that owns them rather than typed again here. */
export const RECIPE_IDS = COOKBOOK_SLUGS;

export type RecipeId = (typeof RECIPE_IDS)[number];

export const RECIPE_VERSION = COOKBOOK_RECIPE_VERSION;
export type RecipeVersion = typeof RECIPE_VERSION;

export function isRecipeId(value: unknown): value is RecipeId {
  return typeof value === "string" && (RECIPE_IDS as readonly string[]).includes(value);
}

export function isRecipeVersion(value: unknown): value is RecipeVersion {
  return value === RECIPE_VERSION;
}

/**
 * Every path a recipe may return to, written out.
 *
 * An allow-list of exact paths rather than a same-origin *test*, because every same-origin test
 * has a bypass: `//evil.example`, a backslash, a percent-encoded scheme, a path traversal, a
 * userinfo `@`. Exact membership has none of them, and it also refuses the same-origin paths a
 * recipe has no business resuming into -- `/workspace`, an API route, anything authenticated.
 *
 * The cookbook entries are derived from `RECIPE_IDS` so the two lists cannot drift; the two extra
 * entries are the surfaces a reader can start a recipe from today.
 */
export const RETURN_TO_PATHS = [
  ...RECIPE_IDS.map((id) => `/cookbooks/${id}` as const),
  "/resources",
  "/explore",
] as const;

export type ReturnToPath = (typeof RETURN_TO_PATHS)[number];

export function isAllowedReturnTo(value: unknown): value is ReturnToPath {
  return typeof value === "string" && (RETURN_TO_PATHS as readonly string[]).includes(value);
}

export function defaultReturnTo(recipeId: RecipeId): ReturnToPath {
  return `/cookbooks/${recipeId}`;
}

export type RecipeIntent = {
  recipeId: RecipeId;
  recipeVersion: RecipeVersion;
  returnTo: ReturnToPath;
};

/**
 * The only validator. Rebuilds the intent from three named keys, so anything else the caller
 * sent -- a plan, a price, a workspace id, a `__proto__` -- is dropped rather than carried.
 */
export function parseRecipeIntent(value: unknown): RecipeIntent | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isRecipeId(record.recipeId)) return null;
  if (!isRecipeVersion(record.recipeVersion)) return null;
  if (!isAllowedReturnTo(record.returnTo)) return null;
  return { recipeId: record.recipeId, recipeVersion: record.recipeVersion, returnTo: record.returnTo };
}

/** Where a reader goes when they start a recipe from a cookbook. Carries no campaign parameters. */
export function loginUrlForRecipe(recipeId: RecipeId, returnTo: ReturnToPath = defaultReturnTo(recipeId)) {
  const params = new URLSearchParams({
    next: "recipe",
    recipe: recipeId,
    v: RECIPE_VERSION,
    returnTo,
  });
  return `/login?${params.toString()}`;
}

/** Reads an intent out of a query string, returning null for anything off the lists. */
export function readRecipeParams(search: string): RecipeIntent | null {
  const params = new URLSearchParams(search);
  if (params.get("next") !== "recipe") return null;
  const recipeId = params.get("recipe");
  return parseRecipeIntent({
    recipeId,
    recipeVersion: params.get("v"),
    returnTo: params.get("returnTo") ?? (isRecipeId(recipeId) ? defaultReturnTo(recipeId) : null),
  });
}

const KEY = "tavonel.recipe-intent";

export function rememberRecipeIntent(intent: RecipeIntent) {
  try {
    // Serialise the parsed object, never the caller's: an extra field cannot reach storage.
    const safe = parseRecipeIntent(intent);
    if (safe) window.sessionStorage.setItem(KEY, JSON.stringify(safe));
  } catch {
    // A browser with site data blocked still gets a working sign-in; it just forgets the recipe.
  }
}

/** Reads and clears in one step, so a resumed recipe cannot fire twice on a reload. */
export function takeRecipeIntent(): RecipeIntent | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return raw === null ? null : parseRecipeIntent(JSON.parse(raw));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ attribution, kept separate */

export const ATTRIBUTION_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type AttributionField = (typeof ATTRIBUTION_FIELDS)[number];
export type Attribution = Partial<Record<AttributionField, string>>;

const ATTRIBUTION_KEY = "tavonel.first-touch.v1";
/** Campaign values are short labels. A longer one is a payload, and is refused rather than cut. */
const ATTRIBUTION_VALUE_LIMIT = 120;

/** The five campaign fields, and only those, read off a query string. */
export function readAttributionParams(search: string): Attribution | null {
  const params = new URLSearchParams(search);
  const found: Attribution = {};
  for (const field of ATTRIBUTION_FIELDS) {
    const value = params.get(field)?.trim();
    if (value && value.length <= ATTRIBUTION_VALUE_LIMIT) found[field] = value;
  }
  return Object.keys(found).length > 0 ? found : null;
}

export function readFirstTouch(): Attribution | null {
  try {
    const raw = window.sessionStorage.getItem(ATTRIBUTION_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const found: Attribution = {};
    for (const field of ATTRIBUTION_FIELDS) {
      const value = record[field];
      if (typeof value === "string" && value.length > 0 && value.length <= ATTRIBUTION_VALUE_LIMIT) {
        found[field] = value;
      }
    }
    return Object.keys(found).length > 0 ? found : null;
  } catch {
    return null;
  }
}

/**
 * Records where this reader came from, once.
 *
 * Returns the record in force afterwards, which for every visit after the first is the one
 * already stored. Nothing internal calls this with an internal id, and there is no code path
 * that overwrites a stored first touch -- that is the whole of the guarantee.
 */
export function rememberFirstTouch(search: string): Attribution | null {
  const existing = readFirstTouch();
  if (existing) return existing;
  const arriving = readAttributionParams(search);
  if (!arriving) return null;
  try {
    window.sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(arriving));
  } catch {
    return arriving;
  }
  return arriving;
}
