#!/usr/bin/env node
/*
  IndexNow submission for tavonel.com (GX-04, docs/policy/DECISION_LOG_2026-11-09.md).

  Run by hand after a production deploy, never from the build:

    node scripts/indexnow-ping.mjs            # reads the live sitemap and submits every URL
    node scripts/indexnow-ping.mjs --dry-run  # prints the payload and sends nothing

  The key is public by design: the protocol proves ownership by serving it at
  https://tavonel.com/<key>.txt, which is `public/<key>.txt`. This script reads the key from that
  file, checks that the live site serves the same body, and refuses to submit if it does not.
  Exit 0 on a 200/202 answer, 1 on anything else.
*/
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const HOST = "tavonel.com";
export const ENDPOINT = "https://api.indexnow.org/indexnow";
const KEY_FILE = /^([0-9a-f]{32})\.txt$/;

/** The one key file in public/. Two keys, or none, is a configuration error. */
export function readKey(publicDir = fileURLToPath(new URL("../public/", import.meta.url))) {
  const keys = readdirSync(publicDir).map((name) => KEY_FILE.exec(name)?.[1]).filter(Boolean);
  if (keys.length !== 1) throw new Error(`expected exactly one IndexNow key file in public/, found ${keys.length}`);
  const [key] = keys;
  const body = readFileSync(join(publicDir, key + ".txt"), "utf8").trim();
  if (body !== key) throw new Error(`public/${key}.txt does not contain its own key`);
  return key;
}

/** Every <loc> in a sitemap, on this host only. */
export function sitemapUrls(xml) {
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]);
  return [...new Set(urls.filter((url) => new URL(url).host === HOST))];
}

export function payload(urls, key) {
  if (urls.length === 0) throw new Error("the sitemap listed no URL on this host");
  return { host: HOST, key, keyLocation: `https://${HOST}/${key}.txt`, urlList: urls };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const key = readKey();
  const served = await fetch(`https://${HOST}/${key}.txt`);
  if (!served.ok || (await served.text()).trim() !== key) throw new Error(`https://${HOST}/${key}.txt does not serve the key (HTTP ${served.status}); deploy first`);
  const sitemap = await fetch(`https://${HOST}/sitemap.xml`);
  if (!sitemap.ok) throw new Error(`sitemap.xml answered HTTP ${sitemap.status}`);
  const body = payload(sitemapUrls(await sitemap.text()), key);
  if (dryRun) { console.log(JSON.stringify(body, null, 2)); return; }
  const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
  console.log(JSON.stringify({ event: "indexnow_submitted", status: response.status, urls: body.urlList.length }));
  if (response.status !== 200 && response.status !== 202) {
    console.error(await response.text());
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(`indexnow-ping: ${error.message}`); process.exitCode = 1; });
}
