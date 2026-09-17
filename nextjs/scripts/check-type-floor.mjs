#!/usr/bin/env node
/*
  The 12px type floor, and the two colour tokens that are not text colours.

  The previous floor was an allowlist inside `app/tavonel.css` — a `:is(...)` block naming thirty
  selectors and setting them to 12px. Every CSS module escaped it by construction (a module class
  is not in that list and cannot be), and a measurement across the public routes found 220
  declarations below the floor, 138 on /explore alone, some at 8px.

  So the floor is a grep over every stylesheet in the repository rather than a rule inside one of
  them, and the exceptions are named in `lib/type-floor-exceptions.json` with a reason each.

  Two more checks ride along, because they are the same shape of mistake — a value that reads fine
  in isolation and fails where it lands:

  - `--decor` and `--reused` are surface tones (2.2:1 to 2.65:1 on the panel grounds). They are
    legitimate for a rule, a glyph or an inert control, and never for a `color:` carrying words.
  - `--text-xlo` was within 1.03:1 of `--text-lo` and failed AA on `--g3`. It survived one
    integration cycle as an alias and this check counted what was left; D24 deleted it, so a
    stylesheet that still reads the name now resolves to nothing at all. It is a violation rather
    than a census, and unlike the floor an excused sheet gets no dispensation from it: an excused
    sheet is a sheet with small type in it, not a sheet allowed to read a token that is gone.

  Usage: node scripts/check-type-floor.mjs        (fails the build on a violation)
         node scripts/check-type-floor.mjs --census (prints the per-sheet count for known_issues)
*/

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const FLOOR_PX = 12;

const exceptions = JSON.parse(readFileSync(join(root, "lib/type-floor-exceptions.json"), "utf8"));
const exemptSelectors = exceptions.selectors.map((entry) => entry.match);
const exemptFiles = (exceptions.files ?? []).map((entry) => (typeof entry === "string" ? entry : entry.file));

function stylesheets(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) stylesheets(full, found);
    else if (entry.endsWith(".css")) found.push(full);
  }
  return found;
}

/** The nearest selector above a line, which is what an exception is written against. */
function selectorFor(lines, index) {
  for (let i = index; i >= 0; i -= 1) {
    const open = lines[i].indexOf("{");
    if (open === -1) continue;
    const head = lines[i].slice(0, open).trim();
    if (head && !head.startsWith("@")) return head;
  }
  return "";
}

const violations = [];
const excusedCounts = new Map();

for (const file of stylesheets(root)) {
  const rel = relative(root, file).replace(/\\/g, "/");
  const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
  // A listed file is excused the floor, not the deleted-token check: --text-xlo resolves to
  // nothing now, so reading it is a broken declaration rather than a debt with a number on it.
  const excused = exemptFiles.includes(rel);

  lines.forEach((line, index) => {
    if (line.trim().startsWith("/*") || line.trim().startsWith("*")) return;
    const sizes = [];
    for (const match of line.matchAll(/font-size:\s*([0-9.]+)px/g)) sizes.push(Number(match[1]));
    // `font: 500 9px/1.4 var(--f-mono)` — the size is the px value in the shorthand.
    for (const match of line.matchAll(/font:\s*[^;{}]*?([0-9.]+)px/g)) sizes.push(Number(match[1]));

    const small = sizes.filter((size) => size < FLOOR_PX);
    if (small.length) {
      const selector = selectorFor(lines, index);
      const exempt = exemptSelectors.some((needle) => selector.includes(needle) || line.includes(needle));
      if (!exempt) {
        const entry = `${rel}:${index + 1}  ${selector || "?"}  →  ${small.join("px, ")}px`;
        // An excused sheet is a debt with a number on it, not a hole in the check: the count it had
        // when its lane took ownership is the ceiling, so a new 8px label still fails the build.
        // (Excusing a sheet from the check entirely is what let 220 sub-12px declarations accumulate.)
        if (excused) excusedCounts.set(rel, (excusedCounts.get(rel) ?? 0) + 1);
        else violations.push(entry);
      }
    }

    // A `content:` in the same rule means the mark is drawn, not written — which is what --decor is for.
    if (
      /color:\s*[^;]*var\(--(decor|reused)\)/.test(line) &&
      !/border-color|background|outline-color|caret-color|content:/.test(line)
    ) {
      const entry = `${rel}:${index + 1}  ${selectorFor(lines, index) || "?"}  →  --decor/--reused used as a text colour`;
      if (excused) excusedCounts.set(rel, (excusedCounts.get(rel) ?? 0) + 1);
      else violations.push(entry);
    }
    if (line.includes("var(--text-xlo)")) {
      violations.push(`${rel}:${index + 1}  ${selectorFor(lines, index) || "?"}  →  reads --text-xlo, which no longer exists`);
    }
  });
}

if (process.argv.includes("--census")) {
  console.log("Findings per excused sheet (the number that belongs in known_issues):");
  for (const [file, count] of [...excusedCounts].sort()) console.log(`  ${count}	${file}`);
  console.log("");
}

// The ratchet: an excused sheet may not get worse while it waits for its lane.
for (const entry of exceptions.files ?? []) {
  if (typeof entry === "string") continue;
  const found = excusedCounts.get(entry.file) ?? 0;
  const ceiling = entry.known_issues;
  if (typeof ceiling !== "number") {
    violations.push(`lib/type-floor-exceptions.json  ${entry.file}  →  needs a "known_issues" count`);
  } else if (found > ceiling) {
    violations.push(`${entry.file}  →  ${found} findings, up from ${ceiling}. An excused sheet may not get worse.`);
  }
}

if (violations.length) {
  console.error(`Type floor: ${violations.length} violation(s). The floor is ${FLOOR_PX}px.\n`);
  for (const entry of violations) console.error(`  ${entry}`);
  console.error(
    "\nRaise the size, or add a named exception with a reason to lib/type-floor-exceptions.json.\n" +
      "A label that does not fit at 12px is a label that is too long.\n" +
      "A rule that reads --text-xlo wants --text-lo: the alias is deleted.\n",
  );
  process.exit(1);
}

console.log(`Type floor: clean (${FLOOR_PX}px) across every stylesheet.`);
