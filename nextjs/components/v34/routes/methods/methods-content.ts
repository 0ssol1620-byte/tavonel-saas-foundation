import type { Route } from "next";
import { clause } from "@/lib/compiler-contract";
import { MCP_TOOL_COUNT_WORD } from "@/lib/mcp-tools";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of the methods page that are not the shared pieces' own. Plain data, so the guard test
  can read every sentence in one place.

  Three rules hold for everything here:
  - A destination is a registry key, never a typed path. `to()` resolves it, and the test fails if
    the route it names is held. `/sources` is the one retained route, named once below.
  - There is no number in this file. The ordinals ("01", "02") are counted from the list position
    and the MCP tool count is the spelled word `lib/mcp-tools.ts` computes.
  - Each stage says what it takes in, what it produces and what is checked. The check is a thing
    this deployment does today: a selective rebuild, a point-in-time read and a second reader are
    directions in the compiler contract and are not described here.
*/

const to = (key: V34RouteKey): Route => v34Route(key).path;

const record = v34Route("methods");

/** The one retained route this page links, the per-format list of what is read. */
export const SOURCES_HREF = "/sources" satisfies Route;

if (clause("temporal-integrity").state !== "demonstrated") {
  throw new Error("the methods page states the version handling as shipped, and the clause has changed state");
}

export const HERO = {
  eyebrow: record.ogLabel,
  title: record.heading,
  lead: record.description,
  secondary: { href: to("compiler"), label: "Read about the compiler" },
  figure: "Source file, evidence region, record and relationship, with a check at each step.",
} as const;

export const STAGES = {
  eyebrow: "The method",
  title: "From a source file to the next version.",
  lead: "Every stage takes an input, produces an output and has a check you can look at.",
  items: [
    {
      title: "Bring your sources",
      text: "Choose files. Each accepted source receives a version.",
      input: "Source file",
      output: "Versioned input",
      check: "Each file is validated against the supported-format list when it is uploaded.",
      link: { href: SOURCES_HREF, label: "Supported sources" },
    },
    {
      title: "Read the document",
      text: "Sanitize to PDF and read the text with page coordinates. Reading uncertainty stays with the result.",
      input: "Accepted source",
      output: "Text, page and region",
      check: "A failed read opens review rather than passing.",
      link: { href: to("compiler"), label: "How the compiler reads" },
    },
    {
      title: "Bind the evidence",
      text: "A passage keeps the exact source version, excerpt, page and region. You can open the place it came from.",
      input: "Extracted passage",
      output: "Source-bound record",
      check: "The package verifier reports any evidence reference left dangling.",
      link: { href: to("evidence"), label: "Inspect the evidence" },
    },
    {
      title: "Review a World",
      text: "The compile produces a candidate. A candidate and the active version are separate, so review state and unresolved material stay visible.",
      input: "Compiled candidate",
      output: "Reviewed version",
      check: "A person activates the candidate, and the version it replaces stays readable.",
      link: { href: to("world"), label: "Inspect the World" },
    },
    {
      title: "Connect your AI",
      text: "Read the active World through the MCP tools or the HTTP API, or request a signed package. Retrieval keeps the same evidence references.",
      input: "Active World",
      output: "MCP, API and export",
      check: `The MCP server exposes ${MCP_TOOL_COUNT_WORD} tools, all read-only.`,
      link: { href: to("connect"), label: "Connect your AI" },
    },
    {
      title: "Compile the next version",
      text: "New sources produce a new candidate to compare and review. A compile rebuilds the collection it is given.",
      input: "Changed sources",
      output: "Next candidate and change record",
      check: "Compare the two versions by manifest digest and read what changed.",
      link: { href: to("changes"), label: "Explore changes" },
    },
  ],
} as const;

export const SURFACE = {
  title: "Under the surface.",
  lead: "Three kinds of work, each one visible in the result.",
  phases: [
    { name: "Read", detail: "Text, page, region" },
    { name: "Compile", detail: "Objects, claims, relationships" },
    { name: "Check", detail: "Evidence, versions, package" },
  ],
  items: [
    {
      title: "Reading fidelity",
      text: "The compile receives exactly what the read produced: the page, the paragraph text and the exact region.",
    },
    {
      title: "Knowledge compilation",
      text: "An object carries a stable key derived from its content, so compiling the same source again lands on the same object. Relationships are typed and carry their evidence.",
    },
    {
      title: "Version refresh",
      text: "A compile rebuilds the collection it is given into a new candidate, and the version it replaces stays readable.",
    },
  ],
  link: { href: to("compiler"), label: "Walk through the compiler" },
} as const;

export const OUTCOMES = {
  eyebrow: "What you can do",
  title: "Use a compiled World.",
  lead: "Four things a finished World makes possible, each one on its own page.",
  items: [
    { kicker: "Find", title: "Locate the source.", text: "Open a source region and read the passage beside its page.", link: { href: to("evidence"), label: "Explore evidence →" } },
    { kicker: "Understand", title: "Follow the relationship.", text: "Follow a relationship to the evidence that supports it.", link: { href: to("world"), label: "Inspect the World →" } },
    { kicker: "Compare", title: "See what changed.", text: "Compare two versions of a World and read the difference.", link: { href: to("changes"), label: "Explore changes →" } },
    { kicker: "Connect", title: "Bring your AI.", text: "Read the World from an AI client over MCP or the HTTP API.", link: { href: to("connect"), label: "Connect your AI →" } },
  ],
} as const;

export const FINAL = {
  title: "Create your first World.",
  secondary: { href: to("studio"), label: "Open the reference walkthrough →" },
} as const;

/** Every internal destination the page can render, for the release guard. */
export const METHODS_DESTINATIONS: readonly Route[] = [
  HERO.secondary.href,
  ...STAGES.items.map((item) => item.link.href),
  SURFACE.link.href,
  ...OUTCOMES.items.map((item) => item.link.href),
  FINAL.secondary.href,
];
