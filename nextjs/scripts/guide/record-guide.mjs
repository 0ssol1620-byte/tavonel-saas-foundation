// Guide videos: record one guide video from live https://tavonel.com with Playwright chromium.
//
// What is real: every browser scene is the live production site, driven by clicks a person could
// make. No fixture build, no request interception, no response edit, no DOM edit -- with one
// declared exception: a synthetic cursor element (#__guide_cursor, pointer-events:none) is
// injected so a viewer can see where each action happens. Terminal scenes load a local replay
// page generated from terminal/<session>.json, a captured real session (see capture-terminal.mjs).
//
// Captions come from GUIDE-SCRIPTS.json. Each beat logs its start time against the video clock;
// cue i runs from beat i to beat i+1, so a caption is on screen exactly while its scene is.
//
// usage: node nextjs/scripts/guide/record-guide.mjs <guide-1-explore|guide-2-mcp|guide-3-api> <desktop|phone>
//   GUIDE_WORK  scratch directory, outside the repo: raw/<guide>-<variant>.{webm,beats.json,*.vtt}
//               (default: see terminal-replay.mjs)
//   READ_MS_PER_CHAR  caption reading time (default 62)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildReplay, GUIDE_WORK } from "./terminal-replay.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "..", "..", "package.json"));
const { chromium } = require("@playwright/test");
const playwrightVersion = require("@playwright/test/package.json").version;

const SITE = "https://tavonel.com";
const [GUIDE, VARIANT] = process.argv.slice(2);
const SCRIPT = JSON.parse(readFileSync(join(HERE, "GUIDE-SCRIPTS.json"), "utf8")).guides[GUIDE];
const VARIANTS = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const V = VARIANTS[VARIANT];
if (!SCRIPT || !V) throw new Error("usage: node record-guide.mjs <guide-1-explore|guide-2-mcp|guide-3-api> <desktop|phone>");
const PHONE = VARIANT === "phone";
// Reading time per caption: ms per character of the English line, floor 4 s.
const READ_MS_PER_CHAR = Number(process.env.READ_MS_PER_CHAR ?? 62);

const RAW = join(GUIDE_WORK, "raw");
const tmp = join(RAW, `${GUIDE}-${VARIANT}.tmp`);
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  ...V,
  locale: "en-US",
  colorScheme: "light",
  recordVideo: { dir: tmp, size: V.viewport },
});
// The synthetic cursor. Installed lazily (on the first move after a page is interactive), so it
// is never part of the server-rendered DOM React hydrates.
await context.addInitScript(() => {
  if (window.top !== window) return;
  const install = (x, y) => {
    let c = document.getElementById("__guide_cursor");
    if (c) return c;
    c = document.createElement("div");
    c.id = "__guide_cursor";
    c.setAttribute("aria-hidden", "true");
    c.style.cssText = "position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;transition:none;";
    c.style.transform = `translate(${x}px, ${y}px)`;
    c.innerHTML =
      '<span id="__guide_ring" style="position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:2px solid #1b1d20;opacity:0"></span>' +
      '<svg width="24" height="24" viewBox="0 0 24 24" style="position:absolute;left:-3px;top:-2px"><path d="M3 2 L3 19 L7.6 15 L10.7 21.6 L13.6 20.3 L10.6 13.8 L17 13.8 Z" fill="#1b1d20" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    return c;
  };
  window.__guideCursor = (from, to) => {
    const c = install(from[0], from[1]);
    c.getBoundingClientRect();
    c.style.transition = "transform 650ms cubic-bezier(.3,.7,.2,1)";
    c.style.transform = `translate(${to[0]}px, ${to[1]}px)`;
  };
  window.__guideClick = () => {
    const r = document.getElementById("__guide_ring");
    if (r) r.animate([{ opacity: 0.85, transform: "scale(.4)" }, { opacity: 0, transform: "scale(1.5)" }], { duration: 450, easing: "ease-out" });
  };
});

const page = await context.newPage();
const t0 = Date.now();
const startedAt = new Date(t0).toISOString();
const clock = () => (Date.now() - t0) / 1000;
let cursor = [V.viewport.width * 0.6, V.viewport.height * 0.55];
const wait = (ms) => page.waitForTimeout(ms);

async function cursorTo(x, y) {
  await page.evaluate(([from, to]) => window.__guideCursor(from, to), [cursor, [x, y]]);
  await page.mouse.move(x, y, { steps: 10 });
  cursor = [x, y];
  await wait(700);
}
async function scrollInto(loc, block = "center") {
  await loc.waitFor({ state: "visible", timeout: 45_000 });
  await loc.evaluate((el, b) => el.scrollIntoView({ behavior: "smooth", block: b }), block);
  await wait(1100);
}
async function point(loc, { block = "center", dx = null, dy = null } = {}) {
  await scrollInto(loc, block);
  // The first line box, not the bounding box: an inline link that wraps on a phone has a bounding
  // box whose centre can sit on a different link.
  const box = await loc.evaluate((el) => {
    const r = el.getClientRects()[0] ?? el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await cursorTo(box.x + (dx ?? Math.min(box.width / 2, 48)), box.y + (dy ?? Math.min(box.height / 2, 22)));
}
async function click(loc, opts) {
  await point(loc, opts);
  await page.evaluate(() => window.__guideClick());
  await wait(180);
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("a,button,[role=button],[role=tab]")?.outerHTML.slice(0, 160) ?? null, cursor);
  const own = await loc.evaluate((el) => el.closest("a,button,[role=button],[role=tab]")?.outerHTML.slice(0, 160) ?? null);
  // Fail closed: the cursor must be on the element the caption names before the click lands.
  if (hit !== own) throw new Error(`cursor is over ${hit}, not ${own}`);
  await page.mouse.click(cursor[0], cursor[1]);
}
async function scrollTop() {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await wait(1000);
}
async function terminal(session) {
  const file = buildReplay(session);
  await page.goto(pathToFileURL(file).href);
  await cursorTo(V.viewport.width - 40, V.viewport.height - 40);
}
const term = (fn, arg) => page.evaluate(([f, a]) => window.__term[f](a), [fn, arg]);
async function pointLine(text) {
  await term("scrollToText", text);
  await wait(700);
  const loc = page.locator(".step:not([hidden]) .line", { hasText: text }).last();
  const box = await loc.boundingBox();
  await cursorTo(box.x + 24, box.y + box.height / 2);
}

const beats = [];
const texts = new Map(SCRIPT.beats.map((b) => [b.id, b]));
async function beat(id, action, minMs = 0) {
  const b = texts.get(id);
  if (!b) throw new Error(`beat ${id} is not in GUIDE-SCRIPTS.json`);
  const start = clock();
  beats.push({ id, start, url: page.url() });
  await action();
  const minimum = Math.max(4000, minMs, b.en.length * READ_MS_PER_CHAR);
  const spent = (clock() - start) * 1000;
  if (spent < minimum) await wait(minimum - spent);
  beats.at(-1).url = page.url();
  process.stderr.write(`${id.padEnd(16)} ${start.toFixed(1)}s  ${page.url()}\n`);
}

const GUIDES = {
  async "guide-1-explore"() {
    await beat("g1-consent", async () => {
      await page.goto(`${SITE}/explore`, { waitUntil: "load", timeout: 90_000 });
      // The notice reveals itself after a delay or a scroll (components/marketing-consent.tsx CONSENT_REVEAL).
      await page.getByRole("button", { name: "No thanks" }).waitFor({ state: "visible", timeout: 20_000 });
      await click(page.getByRole("button", { name: "No thanks" }), { block: "end" });
    });
    await beat("g1-open", async () => {
      await scrollTop();
      await point(page.getByText("Read-only sample · sources captured"));
    });
    await beat("g1-prepared", async () => {
      await point(page.getByText("Prepared retrieval results from this artifact."), { block: "start" });
    });
    await beat("g1-question", async () => {
      await click(page.getByRole("button", { name: "What were Products and Services net sales for the three months ended in December?" }));
      await wait(800);
    });
    await beat("g1-passage", async () => {
      await point(page.getByText("This is a quotation selected by retrieval"));
    });
    await beat("g1-rows", async () => {
      const rows = page.getByRole("button", { name: /\.pdf\s+Page \d+/ });
      await point(rows.first());
      await click(rows.nth(1));
      await wait(1200);
    });
    await beat("g1-region", async () => {
      if (PHONE) await click(page.getByRole("button", { name: "Source", exact: true }));
      await point(page.locator('[data-original-source][data-render-state="ready"] [data-original-region]').first());
    });
    await beat("g1-version", async () => {
      if (PHONE) await click(page.getByRole("button", { name: "Result", exact: true }));
      await point(page.getByText("Source version", { exact: true }));
      await point(page.getByRole("link", { name: /Permanent evidence link/ }));
    });
    await beat("g1-inspector", async () => {
      await click(page.getByRole("button", { name: /Open full evidence inspector/ }));
      await page.waitForURL(/act=evidence/, { timeout: 45_000 });
      await wait(1200);
      await point(page.getByText("This object is supported by this exact source region."), { block: "start" });
    });
    await beat("g1-step", async () => {
      await point(page.getByText("What the compiler read"));
      await click(page.getByRole("button", { name: "Next →" }));
      await wait(1000);
      await click(page.getByRole("button", { name: "Next →" }));
    });
    await beat("g1-change", async () => {
      await scrollTop();
      await click(page.getByRole("button", { name: "CHANGE", exact: true }));
      await page.waitForURL(/act=change/, { timeout: 45_000 });
      await wait(1200);
      await point(page.getByText("The annual World, and the same World after"));
    });
    await beat("g1-arrived", async () => {
      await point(page.getByText("FILINGS THAT ARRIVED", { exact: true }), { block: "start" });
    });
    await beat("g1-counts", async () => {
      await point(page.getByText("Objects reached", { exact: true }));
      await point(page.getByText("Unchanged object identities", { exact: true }));
    });
    await beat("g1-noregion", async () => {
      await point(page.getByText("1 page carries no region, so nothing in this World stands on it.", { exact: false }).first());
    });
    await beat("g1-evidence", async () => {
      await click(page.locator("footer").getByRole("link", { name: "Evidence", exact: true }));
      await page.waitForURL(/\/evidence$/, { timeout: 45_000 });
      await wait(1200);
      await point(page.getByText("One page, and every region a World read from it"), { block: "start" });
    });
    await beat("g1-locator", async () => {
      await point(page.getByText(/bbox [\d,]+ \(per mille\)/).first());
    });
    await beat("g1-back", async () => {
      await click(page.getByRole("link", { name: "Open this region in Explore" }).first());
      await page.waitForURL(/\/explore/, { timeout: 45_000 });
      await wait(1500);
      await point(page.locator('[data-original-source][data-render-state="ready"] [data-original-region]').first());
    });
    await beat("g1-end", async () => {
      await scrollTop();
      await click(page.getByRole("link", { name: "TAVONEL" }).first());
      await page.waitForURL(`${SITE}/`, { timeout: 45_000 });
      await wait(1200);
      await point(page.getByText("A finished Compiled World is open to read in full today", { exact: false }).filter({ visible: true }).first());
    });
  },

  async "guide-2-mcp"() {
    await beat("g2-open", async () => {
      await page.goto(`${SITE}/developers`, { waitUntil: "load", timeout: 90_000 });
      const consent = page.getByRole("button", { name: "No thanks" });
      await consent.waitFor({ state: "visible", timeout: 20_000 }).then(() => click(consent, { block: "end" }), () => {});
      await scrollTop();
      await point(page.getByRole("heading", { level: 1 }));
    });
    await beat("g2-nowrite", async () => {
      await point(page.getByText("No write tool, and the server refuses to start if one is added.").first());
    });
    await beat("g2-download", async () => {
      await point(page.getByText("There is no npm or PyPI package to install", { exact: false }));
      await point(page.getByRole("link", { name: "Download MCP server" }));
    });
    await beat("g2-channel", async () => {
      // On a phone the padded tap target of the next link ("setup and safety contract") overlaps the
      // lower half of this one (live /developers, 2026-10-19); the tap lands on its upper half.
      await click(page.getByRole("link", { name: "public distribution channel" }), PHONE ? { dy: 16 } : {});
      await page.waitForURL(/channel\.json$/, { timeout: 45_000 });
      await wait(800);
      await point(page.getByText('"mcp"', { exact: false }));
    });
    await beat("g2-terminal", async () => { await terminal("mcp"); await term("show", 0); await wait(1200); await term("show", 1); await wait(600); await pointLine('"sha256": "sha256:'); }, 8000);
    await beat("g2-hash", async () => { await term("show", 2); await wait(900); await term("show", 3); await wait(900); await term("show", 4); await wait(400); await pointLine("match: tavonel-mcp.mjs"); }, 8500);
    await beat("g2-version", async () => { await term("show", 5); await wait(400); await pointLine("tavonel-mcp 2026"); }, 6500);
    await beat("g2-nokey", async () => { await term("show", 6); await wait(400); await pointLine("no TAVONEL_ variable"); }, 6500);
    await beat("g2-requests", async () => { await term("show", 7); await wait(400); await pointLine("printf"); }, 7500);
    await beat("g2-raw", async () => {
      await term("show", 8);
      await term("top", 8);
      await wait(1500);
      for (let i = 0; i < 6; i++) { await term("scrollBy", Math.round(V.viewport.height * 0.22)); await wait(700); }
      await pointLine('"isError":true');
    }, 10000);
    await beat("g2-tools", async () => { await term("show", 9); await term("top", 9); await wait(900); await pointLine("tool        list_sources"); await pointLine("tool        download_package"); }, 8000);
    await beat("g2-missing", async () => { await pointLine("tools/call  isError=true"); }, 7000);
    await beat("g2-doctor", async () => { await term("show", 10); await wait(500); await pointLine("FAIL  api_key"); await pointLine("exit code 1"); }, 8000);
    await beat("g2-config", async () => {
      await page.goto(`${SITE}/docs/mcp`, { waitUntil: "load", timeout: 90_000 });
      await point(page.getByRole("heading", { name: "Registering it with a client" }), { block: "start" });
      await point(page.locator("pre", { hasText: '"mcpServers"' }).first());
      await point(page.locator("pre", { hasText: '"mcpServers"' }).getByText("tvnl_live_...", { exact: false }).first());
    });
    await beat("g2-keynote", async () => {
      // A hidden summary list item on /docs/mcp carries the same sentence (live, 2026-11-09).
      await point(page.getByText("The key lives in the client's env block", { exact: false }).filter({ visible: true }).first());
    });
    await beat("g2-desktop", async () => {
      await point(page.getByRole("heading", { name: "Registering it with a client" }), { block: "start" });
    });
    await beat("g2-table", async () => {
      await point(page.getByRole("heading", { name: "The tools it exposes" }), { block: "start" });
      await point(page.getByText("There is no write tool and there is no activation tool.", { exact: false }));
    });
    await beat("g2-end", async () => {
      await page.goto(`${SITE}/developers`, { waitUntil: "load", timeout: 90_000 });
      await point(page.getByText("Compiling your own sources is set up with us rather than enabled by a plan purchase.", { exact: false }).filter({ visible: true }).first());
    });
  },

  async "guide-3-api"() {
    const run = async (label) => {
      const item = page.locator("li", { has: page.getByText(label, { exact: true }) });
      await point(item.getByText(label, { exact: true }), { block: "start" });
      await click(item.getByRole("button", { name: "Run" }));
      await item.locator("pre").waitFor({ state: "visible", timeout: 45_000 });
      await wait(900);
      return item;
    };
    await beat("g3-open", async () => {
      await page.goto(`${SITE}/api`, { waitUntil: "load", timeout: 90_000 });
      const consent = page.getByRole("button", { name: "No thanks" });
      await consent.waitFor({ state: "visible", timeout: 20_000 }).then(() => click(consent, { block: "end" }), () => {});
      await point(page.getByRole("heading", { name: "Try it, with no key" }), { block: "start" });
    });
    await beat("g3-capabilities", async () => {
      const item = await run("What TAVONEL can read");
      await point(item.locator("pre"));
      // Scroll the real response so more of the list is read on screen.
      await item.locator("pre").evaluate((el) => el.scrollTo({ top: el.scrollTop + 260, behavior: "smooth" }));
      await wait(1600);
    }, 9000);
    await beat("g3-status", async () => {
      const item = await run("What is open right now");
      const pre = item.locator("pre");
      await scrollInto(pre, "center");
      // Bring the customerData block of the real response into view inside the <pre>.
      await pre.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const at = n.data.indexOf('"customerData"');
          if (at < 0) continue;
          const r = document.createRange();
          r.setStart(n, at);
          r.setEnd(n, at + 14);
          const rect = r.getBoundingClientRect();
          const box = el.getBoundingClientRect();
          el.scrollTo({ top: el.scrollTop + rect.top - box.top - 24, behavior: "smooth" });
          return;
        }
        throw new Error("customerData not in the response");
      });
      await wait(1200);
      const rect = await pre.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const at = n.data.indexOf('"customerData"');
          if (at < 0) continue;
          const r = document.createRange();
          r.setStart(n, at);
          r.setEnd(n, at + 14);
          const b = r.getBoundingClientRect();
          return [b.x, b.y, b.height];
        }
        return null;
      });
      await cursorTo(rect[0] + 30, rect[1] + rect[2] / 2);
    }, 9000);
    let sample;
    await beat("g3-sample", async () => {
      sample = await run("The shape of an answer");
      await point(sample.getByText("A deterministic product fixture", { exact: false }));
    });
    await beat("g3-digest", async () => {
      await point(sample.getByText("sha-256=", { exact: false }).first());
    });
    await beat("g3-terminal", async () => { await terminal("api"); await term("show", 0); await wait(1000); await term("show", 1); await wait(500); await pointLine("Content-Digest: sha-256"); }, 8000);
    await beat("g3-compare", async () => { await term("show", 2); await wait(900); await pointLine("sha-256=:"); await term("show", 3); await wait(500); await pointLine("match: Content-Digest"); }, 8000);
    await beat("g3-recipe", async () => { await term("show", 4); await wait(700); await term("show", 5); await wait(700); await term("show", 6); await wait(400); await pointLine("match: tavonel-public-sample.py"); }, 8000);
    await beat("g3-run", async () => { await term("show", 7); await wait(600); await pointLine("digest: sha-256"); await pointLine("ev-01 ->"); await pointLine("PUBLIC SAMPLE OK"); }, 9000);
    await beat("g3-disclosure", async () => { await pointLine("disclosure: deterministic_product_sample_not_customer_proof"); }, 6000);
    await beat("g3-cli", async () => { await term("show", 8); await wait(700); await term("show", 9); await wait(400); await pointLine("match: tavonel-cli.mjs"); }, 6500);
    await beat("g3-cli-status", async () => {
      await term("show", 10);
      await term("top", 10);
      await wait(900);
      await pointLine('"readPublicWorld"');
      await pointLine('"compileCustomerDocuments"');
      await term("scrollBy", 60);
      await wait(400);
      const loc = page.locator(".step:not([hidden]) .line", { hasText: '"compileCustomerDocuments"' }).last();
      const next = loc.locator("xpath=following-sibling::div[1]");
      const box = await next.boundingBox();
      await cursorTo(box.x + 24, box.y + box.height / 2);
    }, 10000);
    await beat("g3-end", async () => {
      await page.goto(`${SITE}/docs/quickstart`, { waitUntil: "load", timeout: 90_000 });
      await point(page.getByText("A finished Compiled World is open to read in full today", { exact: false }).filter({ visible: true }).first());
    });
  },
};

let failure = null;
try {
  await GUIDES[GUIDE]();
  await wait(1200);
} catch (error) {
  failure = error;
}
const end = clock();
const video = page.video();
await context.close();
await browser.close();
if (failure) {
  // Fail closed: a guide whose scene did not happen is not encoded with a caption claiming it did.
  console.error(`FAILED at beat ${beats.at(-1)?.id}: ${failure.message}`);
  process.exit(1);
}
const webm = join(RAW, `${GUIDE}-${VARIANT}.webm`);
renameSync(await video.path(), webm);
rmSync(tmp, { recursive: true, force: true });

const cues = beats.map((b, i) => ({ ...b, end: i + 1 < beats.length ? beats[i + 1].start : end }));
const stamp = (s) => {
  const ms = Math.round(s * 1000);
  const mm = String(Math.floor(ms / 60000)).padStart(2, "0");
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${mm}:${ss}.${String(ms % 1000).padStart(3, "0")}`;
};
const vtt = (lang) =>
  `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${texts.get(c.id)[lang]}\n`).join("\n")}`;
writeFileSync(join(RAW, `${GUIDE}-${VARIANT}.en.vtt`), vtt("en"));
writeFileSync(join(RAW, `${GUIDE}-${VARIANT}.ko.vtt`), vtt("ko"));
writeFileSync(
  join(RAW, `${GUIDE}-${VARIANT}.beats.json`),
  `${JSON.stringify({ guide: GUIDE, variant: VARIANT, viewport: V.viewport, deviceScaleFactor: V.deviceScaleFactor, site: SITE, startedAt, endSeconds: end, playwright: playwrightVersion, readMsPerChar: READ_MS_PER_CHAR, cues }, null, 2)}\n`,
);
console.log(`${GUIDE}-${VARIANT}: ${end.toFixed(1)} s, ${beats.length} cues -> ${webm}`);
