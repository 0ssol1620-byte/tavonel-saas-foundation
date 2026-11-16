import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
  V34 D24 M7-01 / U18: no runtime log call passes a raw error, body, token or other sensitive value.
  Static guard: every console.(log|info|warn|error)( call under lib/ and app/ is read, its top-level
  arguments are split, and an argument that is a bare identifier or member expression with a
  sensitive name (or a template string interpolating one) fails the test. Log a code or error.name.
  Provider-side logs (Vercel, Supabase) are not covered here.
*/

const SENSITIVE = new Set(
  "error err cause e body rawbody payload customdata email token secret apikey authorization cookie headers request".split(" "),
);
const CALL = /console\.(?:log|info|warn|error)\(/g;
const ROOT = resolve(__dirname, "..");

// Reviewed exceptions. Each must still match a flagged call, so the list cannot go stale.
const ALLOWLIST: { file: string; reason: string }[] = [
  {
    file: "app/error.tsx",
    reason:
      "Next error boundary runs in the visitor's browser console; the server-side copy of the error is replaced with error.digest by Next. Follow-up: log error.name only (outside WO-D24-3 write scope).",
  },
];

type Finding = { file: string; line: number; arg: string };

/** Index of the ")" closing the call whose "(" is at `open`, skipping strings, templates and comments. */
function closeOf(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
    } else if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) return src.length;
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 1;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (--depth === 0) return i;
    }
  }
  return src.length;
}

function skipString(src: string, start: number): number {
  const q = src[start];
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === "\\") i++;
    else if (q === "`" && src[i] === "$" && src[i + 1] === "{") i = closeOf(src, i + 1);
    else if (src[i] === q) return i;
  }
  return src.length;
}

function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"' || c === "'" || c === "`") i = skipString(inner, i);
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(inner.slice(from, i));
      from = i + 1;
    }
  }
  out.push(inner.slice(from));
  return out.map((a) => a.trim()).filter(Boolean);
}

const REF = /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*$/;
const isSensitiveRef = (expr: string): boolean => {
  const e = expr.trim();
  if (!REF.test(e)) return false;
  const parts = e.split(/\??\./);
  return SENSITIVE.has(parts[parts.length - 1].toLowerCase());
};

function argIsSensitive(arg: string): boolean {
  if (isSensitiveRef(arg)) return true;
  if (arg.startsWith("`")) {
    for (const m of arg.matchAll(/\$\{([^}]*)\}/g)) if (isSensitiveRef(m[1])) return true;
  }
  return false;
}

export function scanSource(file: string, src: string): Finding[] {
  const found: Finding[] = [];
  for (const m of src.matchAll(CALL)) {
    const open = m.index + m[0].length - 1;
    const inner = src.slice(open + 1, closeOf(src, open));
    for (const arg of splitArgs(inner)) {
      if (argIsSensitive(arg)) found.push({ file, line: src.slice(0, m.index).split("\n").length, arg });
    }
  }
  return found;
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") yield* sourceFiles(p);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) yield p;
  }
}

function scanTree(): Finding[] {
  const all: Finding[] = [];
  for (const top of ["lib", "app"]) {
    for (const p of sourceFiles(join(ROOT, top))) {
      all.push(...scanSource(relative(ROOT, p).replaceAll("\\", "/"), readFileSync(p, "utf8")));
    }
  }
  return all;
}

describe("no sensitive value reaches a console call", () => {
  const all = scanTree();

  it("flags a raw error argument (matcher failure path)", () => {
    expect(scanSource("x.ts", 'try {} catch (error) { console.error("x", error); }')).toHaveLength(1);
    expect(scanSource("x.ts", "console.warn(`failed ${err.cause}`)")).toHaveLength(1);
    expect(scanSource("x.ts", "console.log(req.headers)")).toHaveLength(1);
  });

  it("passes a code-only object and a code sample inside a string", () => {
    expect(scanSource("x.ts", 'console.error("x", { code });')).toEqual([]);
    expect(scanSource("x.ts", 'console.error("x", error instanceof Error ? error.name : "unknown")')).toEqual([]);
    expect(scanSource("x.ts", 'console.error(JSON.stringify({ error: e.name }))')).toEqual([]);
  });

  it("has no unreviewed sensitive log call under lib/ and app/", () => {
    const allowed = new Set(ALLOWLIST.map((a) => a.file));
    const bad = all.filter((f) => !allowed.has(f.file)).map((f) => `${f.file}:${f.line} passes \`${f.arg}\``);
    expect(bad).toEqual([]);
  });

  it("keeps no stale allowlist entry", () => {
    for (const a of ALLOWLIST) {
      expect(a.reason.length).toBeGreaterThan(20);
      expect(all.some((f) => f.file === a.file), `${a.file} no longer matches; remove it`).toBe(true);
    }
  });
});
