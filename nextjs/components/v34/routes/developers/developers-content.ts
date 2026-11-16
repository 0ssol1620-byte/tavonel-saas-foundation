import type { Route } from "next";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of the developers page that are not computed. The page title and lead are the registry's.
  The tool names and count come from lib/mcp-tools.ts, the published files from DEVELOPER_FILES in the
  same module, the samples and the operation they call from lib/developer-snippets.ts and the package
  paths from lib/package-contents.ts. There is no number here: step numbers are counted from list
  position and every count is read from its data.
*/

/** A destination is a registry key, resolved here; the page test fails if it names a held route. */
const to = (key: V34RouteKey): Route => v34Route(key).path;

/** Retained public pages outside the registry; the page test checks that each one exists. */
export const QUICKSTART_HREF = "/docs/quickstart" as Route;
export const API_HREF = "/api" satisfies Route;
export const DOCS_HREF = "/docs" satisfies Route;
export const USE_WITH_AI_HREF = "/docs/use-with-ai" as Route;
export const STATUS_HREF = "/status" satisfies Route;
export const WORKSPACE_HREF = "/workspace" satisfies Route;
export const EXPLORE_HREF = "/explore" satisfies Route;
/** Static files and the contract, served as they are. */
export const OPENAPI_HREF = "/api/openapi";
export const CHANNEL_FILE = "/developer/channel.json";
export const README_FILE = "/developer/README.md";

export const HERO = {
  figure: "A request carries a key, and each result carries the source version and the location it was compiled from.",
  primary: { href: QUICKSTART_HREF, label: "Run the quickstart" },
  secondary: { href: API_HREF, label: "API reference" },
} as const;

export const PATHS = {
  eyebrow: "Three ways in",
  title: "Pick how a World reaches your code.",
  live: {
    kind: "Live",
    label: "MCP and the API",
    detail: "The server refuses to start if a tool that writes is added.",
  },
  portable: {
    kind: "Portable",
    label: "A signed package",
    body: "Take the World away as files: JSON-LD and Turtle semantic projections, graph nodes and relationships, a retrieval-ready index, provenance activities and a validation report, under a signed manifest with a digest for every file.",
    detail: "Verifiable offline against a fingerprint you fetch separately. It is a snapshot of one revision, so take the live path when the reader must stay current.",
  },
  human: {
    kind: "Human",
    label: "Ask and the workspace",
    body: "A person asks a question and gets an answer whose citations open the exact source location behind them, or a statement that the available evidence is insufficient rather than a filled gap.",
    detail: "The same World the two machine paths read, with a reviewer in front of it.",
  },
} as const;

export const JOURNEY = {
  eyebrow: "Sources to answer",
  title: "From sources to a grounded answer.",
  items: [
    { title: "Compile and activate a World", text: "Upload or connect sources, review the candidate, and activate it. Activation is a human decision, and only the active revision is served." },
    { title: "Create access", text: "Mint a scoped API key, or point an agent at the MCP server. Creating, rotating and revoking a key each write an audit row." },
    { title: "Query the active World", text: "Search, read objects and relations, or ask a question against the revision that is live right now." },
    { title: "Receive evidence-bound context", text: "Every result carries the source version and the exact location inside it that it was compiled from." },
    { title: "Follow citations back to source", text: "Open that location and read the original. Where the evidence falls short of an answer, the answer says so." },
  ],
  gate: "Connecting your own sources is arranged with us.",
  request: "Discuss your sources",
} as const;

export const FIRST_READ = {
  eyebrow: "First request",
  title: "Your first authenticated read.",
  note: "The HTTP samples use each language's standard library, so there is nothing to install. The MCP sample registers the downloadable server, which exposes the same read as",
  keys: "Keys are created, rotated and revoked in the workspace, under Developers.",
  keysLink: "Workspace, Developers",
} as const;

export const TOOLS = {
  eyebrow: "MCP tools",
  title: "Read-only tools, one list.",
  lead: "The stdio server and the HTTP endpoint share this table, and a tool that writes is refused at start.",
  link: "Connection steps",
} as const;

export const FILES = {
  eyebrow: "Public tooling",
  title: "Published files.",
  table: "Published developer files and what each one does",
  links: { channel: "Distribution record", readme: "Setup and safety contract", openapi: "OpenAPI contract" },
} as const;

export const PACKAGE = {
  eyebrow: "Portable package",
  title: "What is in a signed package.",
  lead: "Every signed export contains these files, written by the exporter and named in a manifest that carries a digest for each one. The two ontology files are the RDF and JSON-LD projection of the compiled objects and relations, with no schema for you to author.",
  table: "Files in a signed export and what each one is for",
  columns: ["Path", "Use it for"],
} as const;

export const NEXT = {
  eyebrow: "Keep reading",
  title: "Where to go next.",
  items: [
    { href: DOCS_HREF, title: "Documentation", text: "The endpoint reference, the error catalogue and the package format." },
    { href: USE_WITH_AI_HREF, title: "Use your results with AI", text: "Choose between live MCP or API access and a portable package." },
    { href: to("connect"), title: "Connect a client", text: "Set up the read-only server in your MCP client." },
    { href: to("evidence"), title: "How evidence is bound", text: "See how a claim stays tied to its source." },
    { href: STATUS_HREF, title: "Status", text: "Current availability of each capability." },
    { href: API_HREF, title: "API reference", text: "Every operation, with a request you can run." },
  ],
} as const;

export const BRIDGE = {
  title: "Make one useful agent call.",
  text: "Follow one agent read from the first request to the source it came from.",
  href: to("journal-mcp"),
  label: "Read the MCP field guide",
} as const;

export const FINAL = {
  title: "Explore the platform contracts.",
  cta: { href: to("platform"), label: "Platform" },
} as const;

/** Every page route the page links to, for the guard test. */
export const DEVELOPERS_DESTINATIONS: readonly Route[] = [
  HERO.primary.href, HERO.secondary.href, WORKSPACE_HREF, EXPLORE_HREF, QUICKSTART_HREF, to("connect"), to("contact"),
  ...NEXT.items.map((item) => item.href), BRIDGE.href, FINAL.cta.href,
];
