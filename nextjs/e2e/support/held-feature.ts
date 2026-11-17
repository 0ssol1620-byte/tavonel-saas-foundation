/*
  A feature the product holds back by decision is shown only where the product shows held routes:
  ADR D01 A9 holds the four-stage film and the specimen strip on Home, and the product renders held
  work only on a preview deployment or with V34_SHOW_HELD=1 (`heldVisible`, lib/v34/release.ts).

  The specs of a held feature run under exactly that condition and skip, with this reason, otherwise.
  They are not deleted and not rewritten: the day the hold is lifted they come back by setting the
  flag in CI. One helper, so the condition is written once; `lib/v34/held-flag.test.ts` fails if this
  flag name and the one the product reads ever differ.

  This module imports nothing from Playwright or Next, so the unit test can load it.
*/

/** The environment variable the product reads to show held work. */
export const HELD_FLAG = "V34_SHOW_HELD";

/** The product's rule, over an environment: a preview deployment, or the flag set to "1". */
export const heldShownIn = (env: Readonly<Record<string, string | undefined>>): boolean =>
  env.VERCEL_ENV === "preview" || env[HELD_FLAG] === "1";

/** Whether the server under test shows held work. The runner and the server share the environment in CI. */
export const HELD_SHOWN = heldShownIn(process.env);

/** The skip reason a held-feature case carries. */
export const HELD_REASON = `held on Home by decision (ADR D01 A9): runs when the server shows held work (${HELD_FLAG}=1)`;
