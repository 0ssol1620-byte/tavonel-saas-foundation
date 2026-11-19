/*
  The film and the specimen strip are markup of components/landing-v2/**. ADR D01 A9 holds them, and
  D33 #11 keeps the components in the tree for rollback, but V34 Home (app/page.tsx) does not import
  them: no flag mounts them, so a case that looks for that markup can never run, whatever
  V34_SHOW_HELD is. These specs are not deleted: the day Home imports landing-v2 again, this gate
  turns true by itself and they run.

  The gate is the import fact, not an environment variable. `lib/v34/held-flag.test.ts` checks it
  against the import graph, and against a fixture that does import landing-v2.

  This module imports nothing from Playwright or Next, so the unit test can load it.
*/
import { fileURLToPath } from "node:url";
import { reach } from "../../lib/v34/import-graph";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** Whether the module graph of `entry` under `graphRoot` reaches components/landing-v2/**. */
export const mountsLandingV2 = (graphRoot: string, entry: string): boolean =>
  [...reach(graphRoot, entry)].some((file) => file.startsWith("components/landing-v2/"));

/** Whether Home mounts the held film / specimen-strip components. False at V34 Home. */
export const HOME_MOUNTS_LANDING_V2 = mountsLandingV2(root, "app/page.tsx");

/** The skip reason of a case that looks for landing-v2 markup. */
export const HOME_NOT_MOUNTED_REASON =
  "not mounted: V34 Home (app/page.tsx) does not import components/landing-v2/** (kept for rollback, D33 #11)";
