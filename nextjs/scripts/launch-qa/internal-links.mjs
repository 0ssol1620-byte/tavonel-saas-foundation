/**
 * Every internal link on the site, followed once.
 *
 * A broken internal link is the cheapest defect to ship and one of the hardest to notice: the
 * page it is on renders, the build passes, and the only person who finds it is a visitor. This
 * crawls from the sitemap, follows every same-origin href it finds, and reports anything that
 * does not answer 2xx or 3xx.
 *
 *   QA_BASE_URL=http://127.0.0.1:3117 node scripts/launch-qa/internal-links.mjs
 *
 * Runs against a built server rather than the dev server, because a route that only exists in
 * development is exactly the kind of link this is meant to catch.
 *
 * Anchors and query strings are stripped before fetching -- a fragment is resolved by the
 * browser and a duplicate query is the same document -- and each path is fetched once no matter
 * how many pages link to it.
 */

const baseUrl = (process.env.QA_BASE_URL ?? "http://127.0.0.1:3117").replace(/\/$/, "");
const MAX_PAGES = 200;

async function text(path) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
  const body = response.headers.get("content-type")?.includes("text/html") ? await response.text() : "";
  return { status: response.status, location: response.headers.get("location"), body };
}

function hrefsIn(html) {
  return [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => value.startsWith("/") && !value.startsWith("//"))
    .map((value) => value.split("#")[0].split("?")[0])
    .filter((value) => value.length > 0);
}

const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
if (!sitemap.ok) {
  process.stderr.write(`LINK_SWEEP_BLOCKER: ${baseUrl}/sitemap.xml returned HTTP ${sitemap.status}\n`);
  process.exit(2);
}
const seeds = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((match) => new URL(match[1]).pathname);

const queue = ["/", ...seeds];
const seen = new Set();
const failures = [];
const checked = new Map();

while (queue.length > 0 && seen.size < MAX_PAGES) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  seen.add(path);

  const { status, location, body } = await text(path);
  checked.set(path, status);
  if (status >= 400) {
    failures.push(`${path} -> HTTP ${status}`);
    continue;
  }
  if (status >= 300 && location) {
    // A redirect is fine; a redirect to something broken is not.
    const target = location.startsWith("/") ? location : new URL(location, baseUrl).pathname;
    if (!seen.has(target)) queue.push(target);
    continue;
  }

  for (const href of hrefsIn(body)) {
    if (seen.has(href) || queue.includes(href)) continue;
    // Static assets and API routes are followed once but not crawled for links.
    queue.push(href);
  }
}

process.stdout.write(`checked ${checked.size} internal paths from ${baseUrl}\n`);
if (failures.length > 0) {
  process.stderr.write(`INTERNAL LINK FAILURES (${failures.length}):\n${failures.map((line) => `  ${line}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("no broken internal links\n");
