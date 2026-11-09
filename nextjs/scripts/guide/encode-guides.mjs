// Guide videos: encode the six raw recordings into public/guide/, cut a poster from each, rebuild
// the captions from GUIDE-SCRIPTS.json, refresh public/guide/manifest.json and write a local receipt.
//
// H.264 baseline, yuv420p, 25 fps, no audio, +faststart, with ffmpeg 7.1 (Playwright's bundled ffmpeg
// is VP8/WebM-only and cannot write H.264). CRF starts at 26 and rises in steps of 2 until a desktop
// file is at or under 3,000,000 bytes. Each poster is one real frame of the encoded MP4, JPEG, quality
// lowered until <= 140 KB.
//
// Checks (fail closed, exit 1): captions carry no digit and none of the banned words; KO and EN have
// the same cues; every duration is inside its target window; every poster <= 140 KB; every desktop
// MP4 <= 3 MB.
//
// manifest.json: every top-level field (sourceRelease, sourceReleaseBasis, rights, howRecorded, ...)
// is carried over as a person wrote it; only `files` is measured and rewritten here.
//
// usage: node nextjs/scripts/guide/encode-guides.mjs
//   GUIDE_WORK     scratch directory holding raw/ from record-guide.mjs (default: see terminal-replay.mjs)
//   GUIDE_OUT      where the media and manifest go (default: nextjs/public/guide)
//   GUIDE_RECEIPTS local receipt with absolute paths and raw-master digests (default: $GUIDE_WORK/../guide-receipts.json)
//   FILM_FFMPEG    ffmpeg 7.1 binary with libx264 (default: imageio-ffmpeg in Python 3.13)
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDE_WORK } from "./terminal-replay.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(GUIDE_WORK, "raw");
const OUT = process.env.GUIDE_OUT ?? join(HERE, "..", "..", "public", "guide");
const RECEIPTS = process.env.GUIDE_RECEIPTS ?? join(GUIDE_WORK, "..", "guide-receipts.json");
const FFMPEG = process.env.FILM_FFMPEG
  ?? "C:/Users/yspow/AppData/Local/Programs/Python/Python313/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe";
if (!existsSync(FFMPEG)) throw new Error(`no ffmpeg at ${FFMPEG}; set FILM_FFMPEG`);
const DESKTOP_MAX = 3_000_000; // decimal MB, the stricter reading of "3 MB"
const POSTER_MAX = 140 * 1024;
const GUIDES = {
  "guide-1-explore": { window: [100, 120], poster: "g1-region" },
  "guide-2-mcp": { window: [120, 150], poster: "g2-missing" },
  "guide-3-api": { window: [100, 120], poster: "g3-compare" },
};
const VARIANTS = ["desktop", "phone"];
const BANNED = [/\bverified\b/i, /\baccuracy\b/i, /\bSDK\b/, /upload your/i, /coming soon/i];

mkdirSync(OUT, { recursive: true });
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const posix = (p) => p.replace(/\\/g, "/");
const failures = [];
const fail = (message) => { failures.push(message); console.error(`FAIL ${message}`); };

function probe(file) {
  const text = spawnSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr;
  const d = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(text);
  const v = /Stream #\S+.*Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(text);
  return {
    durationSeconds: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]),
    codec: v[1],
    profile: /Video: h264 \(([^)]+)\)/.exec(text)?.[1] ?? null,
    width: Number(v[2]),
    height: Number(v[3]),
  };
}
const stamp = (s) => {
  const ms = Math.round(s * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
const entry = (file, extra = {}) => ({ file, bytes: statSync(join(OUT, file)).size, sha256: sha256(join(OUT, file)), ...extra });

const encoderVersion = execFileSync(FFMPEG, ["-hide_banner", "-version"], { encoding: "utf8" }).split("\n")[0];
const scripts = JSON.parse(readFileSync(join(HERE, "GUIDE-SCRIPTS.json"), "utf8")).guides;
const files = [];
const takes = [];
for (const [guide, spec] of Object.entries(GUIDES)) {
  for (const b of scripts[guide].beats) {
    for (const lang of ["ko", "en"]) {
      if (/\d/.test(b[lang])) fail(`${guide} ${b.id} ${lang} caption carries a digit: ${b[lang]}`);
      for (const word of BANNED) if (word.test(b[lang])) fail(`${guide} ${b.id} ${lang} caption uses ${word}`);
    }
  }
  for (const variant of VARIANTS) {
    const name = `${guide}-${variant}`;
    const webm = join(RAW, `${name}.webm`);
    const beatsLog = join(RAW, `${name}.beats.json`);
    const beats = JSON.parse(readFileSync(beatsLog, "utf8"));
    const mp4 = join(OUT, `${name}.mp4`);
    let crf = 26;
    for (;;) {
      execFileSync(FFMPEG, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", webm,
        "-c:v", "libx264", "-profile:v", "baseline", "-preset", "slow", "-crf", String(crf),
        "-pix_fmt", "yuv420p", "-r", "25", "-movflags", "+faststart", "-an", mp4,
      ]);
      if (variant !== "desktop" || statSync(mp4).size <= DESKTOP_MAX || crf >= 34) break;
      crf += 2;
    }
    const info = probe(mp4);
    if (info.codec !== "h264" || (info.profile !== "Constrained Baseline" && info.profile !== "Baseline")) fail(`${name} is ${info.codec} ${info.profile}`);
    if (info.durationSeconds < spec.window[0] || info.durationSeconds > spec.window[1]) fail(`${name} runs ${info.durationSeconds}s, outside ${spec.window.join("-")}s`);
    if (variant === "desktop" && statSync(mp4).size > DESKTOP_MAX) fail(`${name} is ${statSync(mp4).size} bytes, over 3,000,000 bytes`);

    const cue = beats.cues.find((c) => c.id === spec.poster);
    const at = Math.max(cue.start, cue.end - 0.8);
    const poster = join(OUT, `${name}.jpg`);
    let q = 3;
    for (;;) {
      execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-ss", at.toFixed(2), "-i", mp4, "-frames:v", "1", "-q:v", String(q), poster]);
      if (statSync(poster).size <= POSTER_MAX || q >= 31) break;
      q += 1;
    }
    if (statSync(poster).size > POSTER_MAX) fail(`${name}.jpg is ${statSync(poster).size} bytes`);

    // Captions are rebuilt from the recorder's logged cue times and the final GUIDE-SCRIPTS.json,
    // so a wording fix after recording needs no re-recording (timing is the recorder's, text is the script's).
    const text = new Map(scripts[guide].beats.map((b) => [b.id, b]));
    const cues = {};
    for (const lang of ["ko", "en"]) {
      const body = beats.cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(Math.min(c.end, info.durationSeconds))}\n${text.get(c.id)[lang]}\n`).join("\n");
      writeFileSync(join(OUT, `${name}.${lang}.vtt`), `WEBVTT\n\n${body}`);
      cues[lang] = (body.match(/-->/g) ?? []).length;
    }
    if (cues.ko !== cues.en || cues.en !== beats.cues.length) fail(`${name} cue counts differ`);

    files.push(
      entry(`${name}.en.vtt`, { cues: cues.en }),
      entry(`${name}.jpg`),
      entry(`${name}.ko.vtt`, { cues: cues.ko }),
      entry(`${name}.mp4`, {
        guide,
        variant,
        width: info.width,
        height: info.height,
        durationSeconds: Math.round(info.durationSeconds * 100) / 100,
        codec: `H.264 ${info.profile} (libx264 crf ${crf}), yuv420p, 25 fps, no audio`,
        recordedAt: beats.startedAt,
      }),
    );
    takes.push({
      name,
      crf,
      poster: { frameAtSeconds: Number(at.toFixed(2)), jpegQ: q, cue: spec.poster },
      master: { path: posix(webm), bytes: statSync(webm).size, sha256: sha256(webm), codec: "VP8 WebM (Playwright recordVideo)" },
      recording: { startedAt: beats.startedAt, endSeconds: beats.endSeconds, viewport: beats.viewport, deviceScaleFactor: beats.deviceScaleFactor, playwright: beats.playwright, beatsLog: posix(beatsLog), beatsLogSha256: sha256(beatsLog) },
    });
    console.log(`${name}: ${info.width}x${info.height} ${info.durationSeconds}s ${statSync(mp4).size} B crf ${crf}; poster ${statSync(poster).size} B q ${q}`);
  }
}
files.sort((a, b) => a.file.localeCompare(b.file));

const manifestPath = join(OUT, "manifest.json");
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
writeFileSync(manifestPath, `${JSON.stringify({ ...previous, files }, null, 2)}\n`);

const receipt = (f) => ({ path: posix(join(HERE, f)), sha256: sha256(join(HERE, f)) });
writeFileSync(RECEIPTS, `${JSON.stringify({
  schema: "tavonel.guide-video-receipts.v1",
  generatedAt: new Date().toISOString(),
  out: posix(OUT),
  manifest: { path: posix(manifestPath), sha256: sha256(manifestPath) },
  encoder: { binary: posix(FFMPEG), version: encoderVersion, sha256: sha256(FFMPEG) },
  terminalCaptures: { mcp: receipt("terminal/mcp.json"), api: receipt("terminal/api.json") },
  scripts: ["GUIDE-SCRIPTS.json", "record-guide.mjs", "capture-terminal.mjs", "terminal-replay.mjs", "encode-guides.mjs"].map(receipt),
  files,
  takes,
  checks: { failures },
}, null, 2)}\n`);
console.log(`${files.length} files -> ${posix(OUT)}; receipt ${posix(RECEIPTS)}; ${failures.length} failures`);
if (failures.length) process.exit(1);
