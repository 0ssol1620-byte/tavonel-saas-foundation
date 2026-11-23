/*
  World lens state in the address bar, so a reload or a shared link lands on the same lens,
  object, evidence pin, version and source revision. Anything that does not match its shape
  is dropped, never coerced: a link someone edited by hand must not steer the page.
*/
export const WORLD_LENS_IDS = ["overview", "graph", "directory", "ontology", "evidence", "versions", "files"] as const;
export type WorldLensId = (typeof WORLD_LENS_IDS)[number];

export type WorldLensParams = { lens?: WorldLensId; object?: string; evidence?: string; asOf?: string; revision?: string };

const ID = /^[A-Za-z0-9:._-]{1,200}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[A-Za-z0-9._:-]{1,128}$/;

// One entry per owned key; reading and writing share it so the two cannot drift.
const KEYS = [
  ["lens", "lens", (v: string) => (WORLD_LENS_IDS as readonly string[]).includes(v)],
  ["object", "object", (v: string) => ID.test(v)],
  ["evidence", "evidence", (v: string) => ID.test(v)],
  ["asof", "asOf", (v: string) => DIGEST.test(v)],
  ["rev", "revision", (v: string) => REVISION.test(v)],
] as const;

export function readWorldLensParams(search: URLSearchParams): WorldLensParams {
  const out: Record<string, string> = {};
  for (const [param, field, valid] of KEYS) {
    const value = search.get(param);
    if (value !== null && valid(value)) out[field] = value;
  }
  return out as WorldLensParams;
}

/** Sets or deletes only the five lens keys; collection, manifest, job and corpus are left alone. */
export function writeWorldLensParams(url: URL, state: WorldLensParams): URL {
  for (const [param, field] of KEYS) {
    const value = state[field];
    if (value) url.searchParams.set(param, value);
    else url.searchParams.delete(param);
  }
  return url;
}
