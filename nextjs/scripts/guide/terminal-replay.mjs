// Guide videos: turn a captured terminal session (terminal/<session>.json) into the page the recorder films.
//
// The page is generated from the capture file and nothing else: every command line, every stdout
// and stderr line, every exit code and wall-clock duration comes out of the JSON verbatim. The page
// reveals steps when the recorder calls window.__term.show(n); it never types, edits or reorders.
//
// usage: node nextjs/scripts/guide/terminal-replay.mjs <mcp|api>   -> $GUIDE_WORK/terminal/<session>.html
//   GUIDE_WORK  scratch directory, outside the repo, shared by every guide script (required)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const GUIDE_WORK = process.env.GUIDE_WORK;
if (!GUIDE_WORK) throw new Error("set GUIDE_WORK to a scratch directory outside the repo");

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const lines = (text, cls) =>
  text === "" ? "" : text.replace(/\n$/, "").split("\n").map((l) => `<div class="line ${cls}">${escapeHtml(l) || "&nbsp;"}</div>`).join("");

export function buildReplay(session) {
  const capture = JSON.parse(readFileSync(join(HERE, "terminal", `${session}.json`), "utf8"));
  const steps = capture.steps
    .map((s, i) => `<section class="step" data-step="${i}" hidden>
<div class="line cmd"><span class="prompt">$</span> ${escapeHtml(s.command)}</div>
${lines(s.stdout, "out")}${lines(s.stderr, "err")}
<div class="line meta"># exit ${s.exitCode} · ${s.ms} ms · ${escapeHtml(s.startedAt)}</div>
</section>`)
    .join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>bash — ${escapeHtml(session)}</title>
<style>
  :root { --paper:#f4f2ed; --ink:#16181b; --text:#e9e7e2; --dim:#8b9099; --prompt:#9cc4a4; --err:#e3b468; }
  * { box-sizing: border-box; }
  html, body { margin:0; height:100%; background:var(--paper); }
  body { padding:24px; font: 15px/1.5 "Cascadia Mono", Consolas, ui-monospace, monospace; }
  .term { height:100%; display:flex; flex-direction:column; background:var(--ink); color:var(--text); border-radius:8px; overflow:hidden; }
  .bar { flex:none; padding:8px 14px; color:var(--dim); font-size:12px; border-bottom:1px solid #2a2d31; }
  .body { flex:1; overflow-y:auto; padding:14px 16px 28px; scroll-behavior:smooth; }
  .line { white-space:pre-wrap; overflow-wrap:anywhere; }
  .cmd { color:#fff; margin-top:12px; }
  .step:first-child .cmd { margin-top:0; }
  .prompt { color:var(--prompt); }
  .err { color:var(--err); }
  .meta { color:var(--dim); font-size:12px; margin-top:2px; }
  @media (max-width: 600px) { body { padding:8px; font-size:11px; } .bar { font-size:10px; } .body { padding:10px 10px 24px; } .meta { font-size:10px; } }
</style></head>
<body><main class="term"><div class="bar">bash · session captured ${escapeHtml(capture.capturedAt)}</div>
<div class="body" id="body">
${steps}
</div></main>
<script>
  const body = document.getElementById("body");
  window.__term = {
    show(n) { for (const s of document.querySelectorAll(".step")) s.hidden = Number(s.dataset.step) > n; body.scrollTop = body.scrollHeight; },
    scrollToText(text) {
      const el = [...document.querySelectorAll(".step:not([hidden]) .line")].find((l) => l.textContent.includes(text));
      if (el) body.scrollTop = el.offsetTop - body.offsetTop - body.clientHeight / 3;
      return Boolean(el);
    },
    scrollBy(px) { body.scrollTop += px; },
    top(n) { const s = document.querySelector('.step[data-step="' + n + '"]'); body.scrollTop = s.offsetTop - body.offsetTop - 8; },
  };
</script>
</body></html>
`;
  mkdirSync(join(GUIDE_WORK, "terminal"), { recursive: true });
  const out = join(GUIDE_WORK, "terminal", `${session}.html`);
  writeFileSync(out, html);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(buildReplay(process.argv[2]));
}
