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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipePreflight } from "../components/recipe-preflight";
import { BILLING_OFFERS } from "./billing-catalog";
import { COOKBOOKS, COOKBOOK_SLUGS, RECIPE_VERSION as COOKBOOK_RECIPE_VERSION } from "./cookbook-content";
import { COOKBOOK_WORKFLOW_IDS, WORKFLOW_IDS } from "./keyword-map";
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

/*
  The one closed list, asserted across the three modules that name it.

  Three lanes each needed the six slugs and only one of them could own the list: the cookbooks
  lane wrote `COOKBOOK_SLUGS`, and both `RECIPE_IDS` here and `COOKBOOK_WORKFLOW_IDS` in
  `lib/keyword-map.ts` were typed out again because `lib/cookbook-content.ts` did not exist on
  their branches. At integration both derive from it, so these assertions are not comparing two
  hand-kept lists -- they are the guard that stops the next author from re-typing one. A retyped
  list is not a type error: every spelling of these six strings type-checks, and drift only shows
  up as a cookbook whose CTA carries a recipe id the carrier refuses.
*/
describe("the six slugs have one owner", () => {
  it("is the same list under all three names", () => {
    expect([...RECIPE_IDS]).toEqual([...COOKBOOK_SLUGS]);
    expect([...COOKBOOK_WORKFLOW_IDS]).toEqual([...COOKBOOK_SLUGS]);
    // Order too, not only membership: `defaultReturnTo` and the keyword rows index by position.
    expect(RECIPE_IDS[0]).toBe(COOKBOOK_SLUGS[0]);
    expect(RECIPE_IDS).toHaveLength(6);
  });

  it("keeps the non-cookbook keyword bucket out of the cookbook list", () => {
    // `category-and-trust` holds the queries that belong to no work package. It is a workflow id
    // and never a slug, and folding it in would make a keyword row claim a cookbook that has no
    // record, no route and no CTA.
    expect(WORKFLOW_IDS).toContain("category-and-trust");
    expect([...COOKBOOK_WORKFLOW_IDS]).not.toContain("category-and-trust");
    expect(WORKFLOW_IDS).toHaveLength(COOKBOOK_WORKFLOW_IDS.length + 1);
  });

  it("carries the version the records were written against", () => {
    expect(RECIPE_VERSION).toBe("2026-09-11");
    expect(RECIPE_VERSION).toBe(COOKBOOK_RECIPE_VERSION);
    for (const record of COOKBOOKS) expect(record.recipeVersion, record.slug).toBe(RECIPE_VERSION);
  });

  it("accepts every cookbook route as a return path, and no other cookbook path", () => {
    for (const slug of COOKBOOK_SLUGS) {
      expect(isAllowedReturnTo(`/cookbooks/${slug}`), slug).toBe(true);
    }
    expect(isAllowedReturnTo("/cookbooks")).toBe(false);
    expect(isAllowedReturnTo("/cookbooks/not-a-record")).toBe(false);
    expect(isAllowedReturnTo("/cookbooks/documents-to-grounded-work/")).toBe(false);
  });

  it("builds the cookbook page's primary control from the carrier, not from a typed URL", () => {
    const page = readFileSync(resolve(import.meta.dirname, "../app/cookbooks/[slug]/page.tsx"), "utf8");
    // The function, not the string: a URL written into the page is a fourth copy of the contract.
    expect(page).toContain("loginUrlForRecipe(record.recipeId)");
    expect(page).not.toMatch(/href="\/login\?/);
    for (const slug of COOKBOOK_SLUGS) {
      const url = loginUrlForRecipe(slug);
      expect(url).toBe(
        `/login?next=recipe&recipe=${slug}&v=${RECIPE_VERSION}&returnTo=${encodeURIComponent(`/cookbooks/${slug}`)}`,
      );
      // And the round trip the button exists for: the URL it produces parses back to the intent.
      expect(readRecipeParams(url.slice(url.indexOf("?")))).toEqual({
        recipeId: slug,
        recipeVersion: RECIPE_VERSION,
        returnTo: `/cookbooks/${slug}`,
      });
    }
  });
});
