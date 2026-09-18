#!/usr/bin/env node
/**
 * Runs the three integration recipes on /docs/integration-recipes against a real deployment.
 *
 * G3-017: the page said "each one is executed by a smoke script in this repository, so a recipe
 * that has drifted from the product fails a check rather than a customer's afternoon", and the
 * script was in a private repository. A verifiability claim nobody can exercise is not a
 * verifiability claim. This is that script, published and pinned by sha256 in
 * https://tavonel.com/developer/channel.json.
 *
 * Every request it makes is an unauthenticated GET. No key, no upload, no compile, nothing that
 * spends. Node 20+, no dependency, no build step -- read it before you run it.
 *
 *   node tavonel-recipe-smoke.mjs --base-url https://tavonel.com
 *   node tavonel-recipe-smoke.mjs --base-url https://tavonel.com mcp
 *
 * Recipes: `mcp` (the server's shape and the tools it refuses to have), `public-sample` (the
 * sample World and its digest), `curl` (capabilities, the contract, the signing key). With no
 * recipe named it runs all three. Exits non-zero on the first failure.
 */

const RECIPES = ["mcp", "public-sample", "curl"];

function parseArgs(argv) {
  const args = { baseUrl: process.env.TAVONEL_RECIPE_BASE_URL ?? "https://tavonel.com", recipes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--base-url") { args.baseUrl = argv[++index]; continue; }
    if (value.startsWith("--base-url=")) { args.baseUrl = value.slice("--base-url=".length); continue; }
    if (RECIPES.includes(value)) { args.recipes.push(value); continue; }
    throw new Error(`unknown argument ${value}. Recipes: ${RECIPES.join(", ")}`);
  }
  if (args.recipes.length === 0) args.recipes = [...RECIPES];
  return args;
}

async function get(baseUrl, path, accept = "application/json") {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, { headers: { accept, "user-agent": "tavonel-recipe-smoke/1" } });
  if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
  return { response, body: await response.arrayBuffer() };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const checks = [];
function record(name, detail) { checks.push(`  ok  ${name}${detail ? ` — ${detail}` : ""}`); }

/*
  Recipe 3 first, because the other two depend on what it establishes: what this deployment can
  read, what its contract publishes, and who signs its exports.
*/
async function curlRecipe(baseUrl) {
  const capabilities = JSON.parse(new TextDecoder().decode((await get(baseUrl, "/api/v1/capabilities")).body));
  assert(capabilities.schemaVersion === "tavonel.capability_manifest.v1", "capability manifest schema changed");
  assert(Array.isArray(capabilities.entries) && capabilities.entries.length > 0, "the capability manifest is empty");
  assert(capabilities.defaultStatus === "UNSUPPORTED", "the manifest no longer defaults to UNSUPPORTED");
  // A verified tier without a published receipt is not representable. Check, do not assume.
  for (const entry of capabilities.entries) {
    if (String(entry.status).startsWith("VERIFIED")) {
      assert(entry.qualificationReceipt, `${entry.mime} claims ${entry.status} with no receipt`);
    }
  }
  record("capabilities", `${capabilities.entries.length} formats, defaultStatus UNSUPPORTED`);

  /*
    The digest a caller keeps. `contentSha256` is taken over the manifest without that field,
    re-serialized with the key order unchanged -- which is why `jq -S` on the docs page prints a
    different value and the page says so. Here the key order is preserved by construction.
  */
  const { contentSha256, ...withoutDigest } = capabilities;
  const recomputed = `sha256:${Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(withoutDigest)))),
  ).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  assert(recomputed === contentSha256, `capability digest mismatch\n  served:   ${contentSha256}\n  computed: ${recomputed}`);
  record("capability digest", "recomputed over the served bytes");

  const spec = JSON.parse(new TextDecoder().decode((await get(baseUrl, "/api/openapi")).body));
  assert(spec.openapi?.startsWith("3."), "the contract is not an OpenAPI 3 document");
  const gated = Object.keys(spec.paths).filter((path) => /promote|rollback/.test(path));
  // The contract's own proof that no key can promote: there is no path for it to call.
  assert(gated.length === 0, `the contract now publishes ${gated.join(", ")}`);
  assert(spec["x-tavonel-decision-gates"]?.promotion === "browser-session-only", "the promotion gate changed");
  const operations = Object.values(spec.paths).flatMap((item) =>
    ["get", "post", "put", "patch", "delete"].filter((method) => item[method]).map((method) => item[method]));
  const unsummarised = operations.filter((operation) => !operation.summary).length;
  assert(unsummarised === 0, `${unsummarised} operations have no summary`);
  record("contract", `${operations.length} operations, no promote or rollback path`);

  const trust = await fetch(`${baseUrl.replace(/\/$/, "")}/api/export/trust`, { headers: { accept: "application/json" } });
  const trustBody = await trust.json();
  if (trust.status === 503) {
    // A deployment with no signer says so rather than handing out a fingerprint nobody can use.
    assert(trustBody.code === "EXPORT_SIGNER_NOT_CONFIGURED", `unexpected 503 body ${JSON.stringify(trustBody)}`);
    record("export trust", "no signer configured on this deployment, stated as such");
  } else {
    assert(trust.ok, `GET /api/export/trust answered ${trust.status}`);
    assert(/^sha256:[a-f0-9]{64}$/.test(trustBody.publicKeySpkiSha256 ?? ""), "the signing fingerprint is not a sha256");
    record("export trust", `${trustBody.algorithm} key ${trustBody.keyId}`);
  }
}

/* Recipe 2, in JavaScript. The published Python script is the one the docs page shows. */
async function publicSampleRecipe(baseUrl) {
  const { response, body } = await get(baseUrl, "/reproducibility/sample-world");
  const header = response.headers.get("content-digest");
  assert(header, "the sample carried no Content-Digest header");
  const digest = `sha-256=:${Buffer.from(new Uint8Array(await crypto.subtle.digest("SHA-256", body))).toString("base64")}:`;
  assert(digest === header.trim(), `sample digest mismatch\n  served:   ${header.trim()}\n  computed: ${digest}`);

  const world = JSON.parse(new TextDecoder().decode(body));
  assert(world.disclosure === "deterministic_product_sample_not_customer_proof", "the sample stopped disclosing what it is");
  const evidence = new Map(world.evidence.map((item) => [item.id, item]));
  for (const object of world.objects) {
    const refs = object.evidenceRefs ?? [];
    if (object.state === "research_frontier") {
      assert(refs.length === 0, `${object.id} is research_frontier and cites ${refs.join(", ")}`);
      continue;
    }
    assert(refs.length > 0, `${object.id} is ${object.state} and cites no evidence`);
    for (const ref of refs) assert(evidence.has(ref), `${object.id} cites ${ref}, which is not in this World`);
  }
  for (const item of world.evidence) {
    const [left, top, right, bottom] = item.bbox1000;
    assert(item.bbox1000.every((value) => value >= 0 && value <= 1000), `${item.id} leaves the 0-1000 page frame`);
    assert(left < right && top < bottom, `${item.id} has a bbox with no area`);
  }
  record("public sample", `${world.objects.length} objects, ${world.evidence.length} evidence records, digest verified`);
}

/*
  Recipe 1 without Claude Desktop: the published MCP server is fetched and read, which is the
  same check a reader is told to do before registering it. It is not executed -- running a
  downloaded file to test it is the habit the whole pinning story exists to replace.
*/
async function mcpRecipe(baseUrl) {
  const channel = JSON.parse(new TextDecoder().decode((await get(baseUrl, "/developer/channel.json")).body));
  const assets = Object.entries(channel.assets ?? {});
  assert(assets.length > 0, "the channel manifest lists no assets");

  let verified = 0;
  for (const [name, asset] of assets) {
    const response = await fetch(asset.url, { headers: { "user-agent": "tavonel-recipe-smoke/1" } });
    assert(response.ok, `${name}: ${asset.url} answered ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const sha = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    // A FAILED line here means do not run that file. That is the entire point of the manifest.
    assert(sha === asset.sha256, `${name} does not match its pin\n  pinned:   ${asset.sha256}\n  computed: ${sha}`);
    verified += 1;
    if (name === "mcp") {
      const source = new TextDecoder().decode(bytes);
      const tools = [...source.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((match) => match[1]);
      assert(tools.length > 0, "no tools found in the MCP server");
      const writes = tools.filter((tool) => /^(create|update|delete|promote|rollback|write|set)_/.test(tool));
      assert(writes.length === 0, `the MCP server registers write tools: ${writes.join(", ")}`);
      record("mcp tools", `${tools.length} read-only tools: ${tools.join(", ")}`);
    }
  }
  record("channel pins", `${verified} of ${assets.length} assets match their sha256`);
}

const RUNNERS = { mcp: mcpRecipe, "public-sample": publicSampleRecipe, curl: curlRecipe };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`smoke: ${args.recipes.join(", ")} against ${args.baseUrl}\n`);
  for (const recipe of args.recipes) {
    try {
      await RUNNERS[recipe](args.baseUrl);
    } catch (error) {
      process.stderr.write(`\nRECIPE FAILED (${recipe}): ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
      return;
    }
  }
  process.stdout.write(`${checks.join("\n")}\nRECIPES OK\n`);
}

await main();
