import type { Route } from "next";
import { clause, PACKAGE_FORMATS } from "@/lib/compiler-contract";
import { DEVELOPER_FILES, MCP_TOOL_COUNT_WORD } from "@/lib/mcp-tools";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of the platform page that are not the shared pieces' own. Plain data, so the guard test
  can read every sentence in one place.

  Three rules hold for everything here:
  - A destination is a registry key, never a typed path. `to()` resolves it, and the test fails if
    the route it names is held. The two published verifier files are the one other destination,
    named from `DEVELOPER_FILES`.
  - There is no number in this file. The MCP tool count is the spelled word `lib/mcp-tools.ts`
    computes; the package formats are the list `lib/compiler-contract.ts` owns.
  - A sentence about what the compiler guarantees is the compiler contract's own promise, read
    from its clause. The clause must still be `demonstrated`, or the build stops, so this page can
    never keep saying a thing that has quietly become a direction.
*/

/** The path of a registered route. */
const to = (key: V34RouteKey): Route => v34Route(key).path;

const record = v34Route("platform");

/** One clause of the compiler contract, as the page states it. */
function promised(id: string) {
  const found = clause(id);
  if (found.state !== "demonstrated") {
    throw new Error(`the platform page states the "${id}" clause as shipped, and it is now ${found.state}`);
  }
  return { title: found.name, text: found.promise };
}

/** The published file a verifier row points at, and what it checks, from the developer distribution. */
function verifier(key: string) {
  const found = DEVELOPER_FILES.find((file) => file.key === key);
  if (!found) throw new Error(`the developer distribution has no "${key}" file`);
  return { href: `/developer/${found.file}`, text: found.purpose };
}

export const HERO = {
  eyebrow: record.ogLabel,
  title: record.title.replace(/ — TAVONEL$/, ""),
  lead: record.description,
  secondary: { href: to("capabilities"), label: "Explore the capabilities" },
  figure: "A source file is read into regions, compiled into a World, and every record keeps its way back to the region it came from.",
} as const;

export const LIFECYCLE = {
  eyebrow: "Lifecycle",
  title: "One lifecycle, end to end.",
  lead: "A source file becomes a versioned World, and everything downstream reads that World.",
  steps: [
    {
      phase: "Capture",
      title: "Bring your files",
      text: "Upload documents in the supported formats. Each source version is identified by the sha256 of the bytes that were read.",
    },
    {
      phase: "Compile",
      title: "Read page by page",
      text: "Each file is sanitized to PDF and read with OCR. Every paragraph keeps its page and the box it sat in.",
    },
    {
      phase: "Compile",
      title: "Compile records",
      text: "The compiler turns what was read into objects, claims and typed relationships. Each relationship carries the evidence that justifies it.",
    },
    {
      phase: "Activate",
      title: "Review a candidate",
      text: "A compile produces a candidate World. A person reviews it and activates it, and the version it replaces stays readable.",
    },
    {
      phase: "Activate",
      title: "Serve it to your AI",
      text: `Read the active World through ${MCP_TOOL_COUNT_WORD} read-only MCP tools or the HTTP API, or request a signed package.`,
    },
  ],
} as const;

export const ATTACHED = {
  eyebrow: "Source, time and structure",
  title: "What stays attached.",
  lead: "The World keeps each record together with its source, its version and its relationships.",
  items: [
    promised("evidence-preserving"),
    promised("temporal-integrity"),
    promised("typed-dependencies"),
    promised("portable-world"),
  ],
} as const;

export const YOUR_AI = {
  title: "Your AI reads the World instead of a prompt full of files.",
  items: [
    {
      title: "Retrieve what matches",
      text: "A question retrieves the matching regions, each with its source version, page and box, instead of a whole corpus pasted into a prompt.",
    },
    {
      title: "Keep your choice of AI",
      text: `The World stays separate from any one conversation. ${MCP_TOOL_COUNT_WORD[0]!.toUpperCase()}${MCP_TOOL_COUNT_WORD.slice(1)} read-only MCP tools and an HTTP API read the same active World.`,
      link: { href: to("connect"), label: "Connect your AI →" },
    },
  ],
} as const;

const packageCheck = verifier("verifyPackage");
const exportCheck = verifier("verifyExport");

export const CHECKS = {
  eyebrow: "Checks",
  title: "Every stage has a check.",
  lead: "Each stage hands the next one something you can inspect.",
  label: "What is checked at each stage",
  columns: ["Stage", "What is checked", "Where to look"],
  rows: [
    {
      stage: "Read",
      text: "Every region keeps its page and its box. A failed read opens review rather than passing.",
      look: { href: to("evidence"), label: "Evidence" },
    },
    {
      stage: "Compile",
      text: "Every relationship is typed and names the evidence that justifies it.",
      look: { href: to("world"), label: "World" },
    },
    {
      stage: "Package",
      text: packageCheck.text,
      look: { href: packageCheck.href, label: "Package verifier", file: true },
    },
    {
      stage: "Activate",
      text: "A person chooses what becomes current. The version it replaces stays intact and readable.",
      look: { href: to("changes"), label: "Changes" },
    },
    {
      stage: "Export",
      text: "The file inventory is signed, every listed file is checked by sha256, and the check runs offline.",
      look: { href: exportCheck.href, label: "Export verifier", file: true },
    },
  ],
} as const;

export const CHANGE = {
  eyebrow: "Over time",
  title: "Built for knowledge that changes.",
  items: [
    {
      title: "Compile the next version.",
      text: "When a source changes, compile a new candidate and compare it with the active World before anything changes for your AI.",
    },
    {
      title: "Keep the history.",
      text: "Every World revision keeps its own manifest digest, and the change view compares two of them side by side.",
      link: { href: to("changes"), label: "Explore changes →" },
    },
  ],
} as const;

export const FORMATS = {
  eyebrow: "Portable",
  title: "Leaves in open formats.",
  lead: "A compiled package carries the same World in the formats other tools already read.",
  label: "Formats in a compiled package",
  columns: ["Format", "Where it sits in the package"],
  rows: PACKAGE_FORMATS,
} as const;

export const FINAL = {
  title: "See the World behind the answers.",
  cta: { href: to("world"), label: "Inspect the World" },
} as const;

/** Every internal destination the page can render, for the release guard. */
export const PLATFORM_DESTINATIONS: readonly Route[] = [
  HERO.secondary.href,
  YOUR_AI.items[1].link.href,
  ...CHECKS.rows.flatMap((row) => (!("file" in row.look) ? [row.look.href] : [])),
  CHANGE.items[1].link.href,
  FINAL.cta.href,
];

/** The published files the checks table downloads. */
export const PLATFORM_FILES: readonly string[] = CHECKS.rows.flatMap((row) => ("file" in row.look ? [row.look.href] : []));
