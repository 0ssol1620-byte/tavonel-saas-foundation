import { describe, expect, it } from "vitest";
import { HELD_FLAG, heldShownIn } from "../../e2e/support/held-feature";
import { heldVisible } from "./release";

/*
  The specs of a held feature (the film and the specimen strip on Home, ADR D01 A9) are gated by
  e2e/support/held-feature.ts on the condition the product uses to show held work. If the product
  renamed its flag, or changed what turns it on, the gated cases would stay skipped while the
  product showed the feature (or run while it hid it). This holds the two to one rule.
*/
describe("the held-feature gate of the specs is the product's own", () => {
  it("names the flag the product reads", () => {
    expect(heldVisible({ [HELD_FLAG]: "1" })).toBe(true);
    expect(heldVisible({})).toBe(false);
  });

  const values = [undefined, "", "0", "1", "true", "preview", "production", "development"];
  const envs = values.flatMap((vercel) => values.map((flag) => ({ VERCEL_ENV: vercel, [HELD_FLAG]: flag })));

  it.each(envs)("agrees with heldVisible on %o", (env) => {
    expect(heldShownIn(env)).toBe(heldVisible(env));
  });
});
