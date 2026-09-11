/**
 * What is allowed to cross the sign-in, and what is not.
 *
 * `checkout-intent.test.ts` states the rule this file inherits: the value in these assertions is
 * what they forbid. A carried recipe is a URL a reader can edit, so three failures matter and
 * each of them is cheap to introduce later by "just adding the field the page needs":
 *
 *   a plan, a price or a workspace id riding along in the payload,
 *   an arbitrary `returnTo` turning the sign-in page into an open redirect,
 *   an internal id overwriting the campaign a reader actually arrived from.
 *
 * All three are tested here, and the last one is why attribution is asserted in this file at all
 * rather than in a file of its own: the bug is the two records touching, so the test has to watch
 * them together.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipePreflight } from "../components/recipe-preflight";
import { BILLING_OFFERS } from "./billing-catalog";
import {
  ATTRIBUTION_FIELDS,
  RECIPE_IDS,
  RECIPE_VERSION,
  RETURN_TO_PATHS,
  defaultReturnTo,
  isAllowedReturnTo,
  loginUrlForRecipe,
  parseRecipeIntent,
  readAttributionParams,
  readFirstTouch,
  readRecipeParams,
  rememberFirstTouch,
  rememberRecipeIntent,
  takeRecipeIntent,
  type RecipeId,
  type RecipeIntent,
} from "./recipe-intent";

const FIRST = RECIPE_IDS[0];
const intentFor = (recipeId: RecipeId = FIRST): RecipeIntent => ({
  recipeId,
  recipeVersion: RECIPE_VERSION,
  returnTo: defaultReturnTo(recipeId),
});

function installStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  });
  return map;
}

function installBlockedStorage() {
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    },
  });
}

describe("recipe intent", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("carries the six cookbook slugs and nothing else", () => {
    expect(RECIPE_IDS).toHaveLength(6);
    expect(new Set(RECIPE_IDS).size).toBe(6);
    for (const id of RECIPE_IDS) expect(id).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
  });

  it("keeps a return path for every recipe, so the two lists cannot drift", () => {
    for (const id of RECIPE_IDS) expect(RETURN_TO_PATHS).toContain(defaultReturnTo(id));
  });

  it("builds a login URL with the ids and no plan, price or workspace", () => {
    for (const id of RECIPE_IDS) {
      const url = loginUrlForRecipe(id);
      expect(url).toContain(`recipe=${id}`);
      expect(url).toContain(`v=${RECIPE_VERSION}`);
      expect(url).toContain("next=recipe");
      expect(url).not.toMatch(/utm_|plan|price|amount|currency|workspace|usd|\$/i);
    }
  });

  it("reads back a URL it wrote, and defaults the return path to the recipe's own page", () => {
    for (const id of RECIPE_IDS) {
      const search = loginUrlForRecipe(id).replace("/login", "");
      expect(readRecipeParams(search)).toEqual(intentFor(id));
      expect(readRecipeParams(`?next=recipe&recipe=${id}&v=${RECIPE_VERSION}`)).toEqual(intentFor(id));
    }
  });

  it("refuses a recipe id that is not on the list", () => {
    for (const bad of ["", "documents", "__proto__", "constructor", "../admin", "documents-to-grounded-work "]) {
      expect(readRecipeParams(`?next=recipe&recipe=${encodeURIComponent(bad)}&v=${RECIPE_VERSION}`)).toBeNull();
    }
  });

  it("refuses a recipe version that is not the one this build serves", () => {
    for (const bad of ["", "2026-09-10", "latest", "2026-09-11 ", "0"]) {
      expect(readRecipeParams(`?next=recipe&recipe=${FIRST}&v=${encodeURIComponent(bad)}`)).toBeNull();
    }
  });

  /*
    The open-redirect list. An allow-list of exact paths is what refuses all of these at once;
    a same-origin *test* has to get every one of them right, and the protocol-relative and
    backslash forms are the two that are normally missed.
  */
  it("refuses a return path that is not on the allow-list", () => {
    const attacks = [
      "https://evil.example/cookbooks/documents-to-grounded-work",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "http://localhost:3000/workspace",
      "javascript:alert(1)",
      "/cookbooks/../admin",
      "/cookbooks/documents-to-grounded-work/../../workspace",
      "/workspace",
      "/api/collections",
      "/cookbooks/documents-to-grounded-work?x=1",
      "/cookbooks/documents-to-grounded-work#top",
      "/cookbooks/documents-to-grounded-work/",
      "/cookbooks/not-a-recipe",
      "",
    ];
    for (const attack of attacks) {
      expect(isAllowedReturnTo(attack), attack).toBe(false);
      expect(
        readRecipeParams(`?next=recipe&recipe=${FIRST}&v=${RECIPE_VERSION}&returnTo=${encodeURIComponent(attack)}`),
        attack,
      ).toBeNull();
    }
  });

  it("ignores recipe parameters with no intent to start a recipe", () => {
    expect(readRecipeParams(`?recipe=${FIRST}&v=${RECIPE_VERSION}`)).toBeNull();
    expect(readRecipeParams(`?next=checkout&recipe=${FIRST}&v=${RECIPE_VERSION}`)).toBeNull();
  });

  it("drops every field that is not one of the three, so a payload cannot name a plan or a price", () => {
    const parsed = parseRecipeIntent({
      ...intentFor(),
      plan: "studio",
      priceUsd: 0,
      workspaceId: "workspace-1",
      entitlement: "promote",
      __proto__: { admin: true },
    });
    expect(parsed).toEqual(intentFor());
    expect(Object.keys(parsed ?? {}).sort()).toEqual(["recipeId", "recipeVersion", "returnTo"]);
  });

  it("refuses anything that is not an intent object", () => {
    for (const bad of [null, undefined, "", 0, [], "recipe", { recipeId: FIRST }]) {
      expect(parseRecipeIntent(bad)).toBeNull();
    }
  });

  it("consumes the stored intent exactly once", () => {
    installStorage();
    rememberRecipeIntent(intentFor());
    expect(takeRecipeIntent()).toEqual(intentFor());
    expect(takeRecipeIntent()).toBeNull();
  });

  it("stores only the three validated fields even when handed more", () => {
    const map = installStorage();
    rememberRecipeIntent({ ...intentFor(), plan: "studio", priceUsd: 99 } as RecipeIntent);
    expect(JSON.parse(map.get("tavonel.recipe-intent") ?? "{}")).toEqual(intentFor());
  });

  it("refuses a stored payload that was tampered with or left by an older build", () => {
    const map = installStorage();
    for (const bad of [
      "not json",
      "null",
      JSON.stringify({ recipeId: FIRST, recipeVersion: "2026-01-01", returnTo: defaultReturnTo(FIRST) }),
      JSON.stringify({ recipeId: "anything", recipeVersion: RECIPE_VERSION, returnTo: defaultReturnTo(FIRST) }),
      JSON.stringify({ recipeId: FIRST, recipeVersion: RECIPE_VERSION, returnTo: "https://evil.example" }),
    ]) {
      map.set("tavonel.recipe-intent", bad);
      expect(takeRecipeIntent(), bad).toBeNull();
      expect(map.has("tavonel.recipe-intent"), bad).toBe(false);
    }
  });

  it("does not throw when the browser refuses storage", () => {
    installBlockedStorage();
    expect(() => rememberRecipeIntent(intentFor())).not.toThrow();
    expect(takeRecipeIntent()).toBeNull();
  });
});

describe("first-touch attribution", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("reads the five campaign fields and nothing else", () => {
    const found = readAttributionParams(
      "?utm_source=news&utm_medium=email&utm_campaign=c1&utm_content=hero&utm_term=kc&gclid=x&recipe=y",
    );
    expect(Object.keys(found ?? {}).sort()).toEqual([...ATTRIBUTION_FIELDS].sort());
    expect(JSON.stringify(found)).not.toContain("gclid");
  });

  it("refuses a campaign value long enough to be a payload", () => {
    expect(readAttributionParams(`?utm_source=${"a".repeat(121)}`)).toBeNull();
    expect(readAttributionParams(`?utm_source=${"a".repeat(120)}`)).toEqual({ utm_source: "a".repeat(120) });
  });

  it("returns nothing for a visit with no campaign on it", () => {
    expect(readAttributionParams("?next=recipe&recipe=" + FIRST)).toBeNull();
  });

  it("keeps the first touch when a later visit carries a different campaign", () => {
    installStorage();
    rememberFirstTouch("?utm_source=news&utm_campaign=launch");
    rememberFirstTouch("?utm_source=ads&utm_campaign=retarget");
    expect(readFirstTouch()).toEqual({ utm_source: "news", utm_campaign: "launch" });
  });

  it("keeps the first touch across an internal hop that carries no campaign", () => {
    installStorage();
    rememberFirstTouch("?utm_source=news");
    rememberFirstTouch(loginUrlForRecipe(FIRST).replace("/login", ""));
    expect(readFirstTouch()).toEqual({ utm_source: "news" });
  });

  /*
    The separation, asserted from both sides. An internal id must never land in the attribution
    record, and a campaign must never land in the carried intent -- one storage key each, and
    neither writer touches the other's.
  */
  it("keeps internal ids out of the attribution record and campaigns out of the intent", () => {
    const map = installStorage();
    rememberFirstTouch("?utm_source=news");
    rememberRecipeIntent(intentFor());
    const attribution = map.get("tavonel.first-touch.v1") ?? "";
    const carried = map.get("tavonel.recipe-intent") ?? "";
    expect(attribution).not.toContain(FIRST);
    expect(attribution).not.toContain("recipe");
    expect(carried).not.toContain("utm_");
    expect(readFirstTouch()).toEqual({ utm_source: "news" });
  });

  it("survives consuming the intent, because attribution is not one-shot", () => {
    installStorage();
    rememberFirstTouch("?utm_source=news");
    rememberRecipeIntent(intentFor());
    takeRecipeIntent();
    expect(readFirstTouch()).toEqual({ utm_source: "news" });
  });

  it("ignores a tampered attribution record and does not throw on blocked storage", () => {
    const map = installStorage();
    for (const bad of ["not json", "null", "[]", JSON.stringify({ utm_source: 1 }), JSON.stringify({ x: "y" })]) {
      map.set("tavonel.first-touch.v1", bad);
      expect(readFirstTouch(), bad).toBeNull();
    }
    installBlockedStorage();
    expect(readFirstTouch()).toBeNull();
    expect(() => rememberFirstTouch("?utm_source=news")).not.toThrow();
  });
});

describe("recipe preflight", () => {
  const render = (props: { intent: RecipeIntent; pages?: number | null }) =>
    renderToStaticMarkup(createElement(RecipePreflight, props));

  it("says where the page count comes from instead of inventing one", () => {
    const html = render({ intent: intentFor() });
    expect(html).toContain("Counted from your own files");
    // The per-page ceiling is a published rate; a total for a run nobody sized is not.
    expect(html).toContain("$0.06 per page");
    expect(html).not.toMatch(/\$\d+\.\d\d for this run/);
  });

  it("quotes the maximum for a measured page count", () => {
    const html = render({ intent: intentFor(), pages: 50 });
    expect(html).toContain("50 pages in this run");
    expect(html).toContain("Up to $3.00 for this run");
  });

  it("refuses to quote a page count that is not a real count", () => {
    for (const pages of [0, -1, 1.5, 10_001]) {
      expect(render({ intent: intentFor(), pages }), String(pages)).toContain("Counted from your own files");
    }
  });

  it("states the activation plan as the catalog has it, with no self-serve path", () => {
    const html = render({ intent: intentFor() });
    expect(BILLING_OFFERS.studio_access.saleChannel).toBe("contact");
    expect(html).toContain(BILLING_OFFERS.studio_access.label);
    expect(html).toContain("set up with you directly");
    expect(html).toContain("/contact");
    expect(html).not.toContain("/pricing");
  });

  it("names the human review gate and the page the reader comes back to", () => {
    const html = render({ intent: intentFor(RECIPE_IDS[2]) });
    expect(html).toContain("Promotion is always an explicit human decision");
    expect(html).toContain(defaultReturnTo(RECIPE_IDS[2]));
  });
});
