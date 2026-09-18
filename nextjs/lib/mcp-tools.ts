/*
  The MCP server's tools and the developer distribution's files, named once.

  G3-006: three pages said "eight tools" and the shipped server registers nine -- `list_worlds`
  was added and never counted, and the wrong number propagated from one changelog entry to
  /developers, /docs/integration-recipes and the MCP download tile. G3-016: the same shape again,
  "five published files" on three surfaces against six in `channel.json`.

  Both counts are now `.length` over the list below, and `lib/developer-distribution.test.ts`
  pins the list against the artifacts themselves -- `public/developer/tavonel-mcp.mjs` for the
  tools and `public/developer/channel.json` for the files, digests included. That is the second
  half of rule 2: a number that cannot be read from its source at render time is pinned by a test
  that compares against it.

  The descriptions are editorial and live here; the names and the count are not.
*/

export const MCP_TOOLS: ReadonlyArray<readonly [string, string]> = [
  ["list_sources", "The workspace's documents, with processing state and version key."],
  ["list_worlds", "The workspace's active Compiled Worlds, with manifest digest and revision. Pages with limit and cursor."],
  ["get_world", "One Compiled World: status, contract, freshness, objects, relations, evidence, history."],
  ["search_world", "Retrieved regions with provenance and ranks. No generated prose."],
  ["ask_world", "A grounded answer with citations, or an abstention."],
  ["get_object", "The objects lens, or one object by stable id. Pages with limit and cursor."],
  ["get_relation", "The relations lens, or one relation by stable id. Pages the same way."],
  ["get_evidence", "Every region with its source version, page and bbox in the 0-1000 page frame. Pages the same way."],
  ["download_package", "Where the signed package is, how large, and what its manifest hashes to."],
];

export const MCP_TOOL_NAMES: readonly string[] = MCP_TOOLS.map(([name]) => name);

/** Spelled out, because "9 read-only tools" reads like a version number in running prose. */
const NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

export function spellNumber(value: number): string {
  const word = NUMBERS[value];
  if (!word) throw new Error(`no spelling for ${value}`);
  return word;
}

export const MCP_TOOL_COUNT_WORD = spellNumber(MCP_TOOLS.length);

/**
 * The published distribution, keyed by the `assets` key in `public/developer/channel.json`.
 *
 * The key order is the order the CLI page introduces them. A file added to the channel and not
 * described here fails `lib/developer-distribution.test.ts`, which is how the sixth asset went
 * uncounted on three surfaces the last time.
 */
export const DEVELOPER_FILES: ReadonlyArray<{ key: string; file: string; purpose: string }> = [
  { key: "cli", file: "tavonel-cli.mjs", purpose: "The upload and compile path from a terminal." },
  { key: "mcp", file: "tavonel-mcp.mjs", purpose: "The read-only MCP bridge, with a --doctor preflight." },
  { key: "sourceAgent", file: "tavonel-source-agent.py", purpose: "Walks a folder or an S3-compatible bucket and pushes what it finds." },
  { key: "verifyExport", file: "tavonel-verify-export.mjs", purpose: "Checks an archive's signature, its file digests and that nothing was added." },
  { key: "verifyPackage", file: "tavonel-verify-package.mjs", purpose: "Checks what is inside: relations resolve, regions sit inside their page, the three graph formats agree." },
  { key: "verifyRoundtrip", file: "tavonel-verify-roundtrip.py", purpose: "Loads the export into SQLite and queries the ids back, outside our tools." },
  { key: "recipePublicSample", file: "tavonel-public-sample.py", purpose: "Recipe 2, runnable: reads the public sample World, recomputes its digest and follows every claim to its evidence." },
  { key: "recipeSmoke", file: "tavonel-recipe-smoke.mjs", purpose: "Runs all three recipes against a deployment. Every request it makes is an unauthenticated GET." },
];

export const DEVELOPER_FILE_COUNT_WORD = spellNumber(DEVELOPER_FILES.length);
