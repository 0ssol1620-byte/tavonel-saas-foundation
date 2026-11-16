import type { Route } from "next";
import { v34Route, type V34RouteKey } from "@/lib/v34/routes";

/*
  The words of the connect page that are not computed. The page title and lead are the registry's.
  The tool count and names come from lib/mcp-tools.ts, the config block from lib/developer-snippets.ts,
  the endpoint's state from lib/remote-mcp.ts and the connector scopes from lib/connector-oauth.ts.
  There is no number here: step numbers are counted from list position.
*/

/** A destination is a registry key, resolved here; the page test fails if it names a held route. */
const to = (key: V34RouteKey): Route => v34Route(key).path;

/** Retained public pages outside the registry; the page test checks that each one exists. */
export const MCP_DOCS_HREF = "/docs/mcp" as Route;
export const WORKSPACE_HREF = "/workspace" satisfies Route;
export const EXPLORE_HREF = "/explore" satisfies Route;
/** Static files under public/developer/, served as they are. */
export const SERVER_FILE = "/developer/tavonel-mcp.mjs";
export const CHANNEL_FILE = "/developer/channel.json";
export const SOURCE_AGENT_FILE = "/developer/tavonel-source-agent.py";
export const SOURCE_AGENT_RUNBOOK = "/developer/source-agent-operations.md";

export const HERO = {
  figure: "A client reaches a World through read-only tools, over a local process or a URL, with one key that can be revoked.",
  primary: { href: MCP_DOCS_HREF, label: "Open the MCP steps" },
  secondary: { href: to("developers"), label: "Build on the API" },
} as const;

export const TRANSPORTS = {
  eyebrow: "Two transports",
  title: "Pick how your client connects.",
  table: "The ways a client connects and the state of each",
  columns: ["Transport", "Where it runs", "Sign-in", "State"],
  local: ["Local server (stdio)", "A process your client launches from tavonel-mcp.mjs on your machine", "An API key in the server's env block", "Available"],
  remote: ["Remote endpoint (HTTP)", "A URL your client connects to", "OAuth with PKCE, or an API key that holds only the read scopes"],
  remoteOpen: "Available",
  remoteClosed: "Closed on this site",
} as const;

export const CLIENTS = {
  eyebrow: "Client by client",
  title: "Where each client reads its setup.",
  lead: "The steps follow each client's own documentation. The MCP page carries the full procedure.",
  table: "Setup location for each client, local and by URL",
  columns: ["Client", "Local server", "By URL"],
  rows: [
    ["Claude Desktop", "claude_desktop_config.json, read when the app starts", "Settings, Connectors, Add custom connector, then sign in"],
    ["Claude Code", ".mcp.json at the root of the project you open", "claude mcp add with the http transport, then /mcp to sign in"],
    ["Cursor", "The same config object, under the client's own path", ".cursor/mcp.json with the URL and a key in the Authorization header"],
    ["Any MCP client", "The same config object, under the client's own path", "A custom remote server with OAuth as its authentication"],
  ],
} as const;

export const STEPS = {
  eyebrow: "Local server",
  title: "From download to first read, step by step.",
  items: [
    { title: "Download the server", text: "Take tavonel-mcp.mjs from the published files and check it against the sha256 in the distribution record before it runs." },
    { title: "Create a read key", text: "In the workspace, open Developers and create an API key with read scopes. The server reads with this key." },
    { title: "Register it", text: "Add the block below to the client's config with the absolute path to the file. The key goes in the env block, which keeps it out of process listings." },
    { title: "Check it", text: "Run node tavonel-mcp.mjs --doctor. It checks the key, the distribution pin and one real read, and names which of the three failed. Restart the client afterwards, because it reads its config at launch." },
    { title: "Read a World", text: "List the tools the client now offers and read an active World with them. Every result carries its source version and the location inside it." },
  ],
  files: { server: "Download the server", channel: "Distribution record", workspace: "Workspace, Developers" },
  config: "Config block for a stdio client",
  configLanguage: "JSON",
} as const;

export const TOOLS = {
  eyebrow: "Read-only tools",
  title: "The tools every transport serves.",
  lead: "The server offers tools that read, and it refuses to start if a tool that writes is added. A World becomes the one a client reads when a person activates it in the browser.",
} as const;

export const SOURCES = {
  eyebrow: "Source systems",
  title: "Bring sources in.",
  lead: "A connector reads your files and writes nothing back. You start each import, and nothing compiles until you start the compile. Connection health, whether configured, expired or unreachable, is reported in your workspace, where you can act on it.",
  gate: "Connecting your own sources is arranged with us.",
  request: "Discuss your sources",
  explore: "Open the public Compiled World",
  legend: [
    ["Read-only", "We hold an OAuth grant scoped to reading, run the sync and write nothing back."],
    ["Customer-run", "You run the import agent inside your network, and the storage credential stays there."],
  ],
  details: "Security and sync details",
  scopes: "Scopes requested",
  writes: "Writes back",
  writesValue: "None. Discovery and download only.",
  deletion: "Deletion",
  cursor: "Incremental cursor",
  agentTitle: "Operating the agent",
  agentTable: "How the source agent is installed, run and updated",
  agentColumns: ["Topic", "Answer"],
  agentRunbook: "The full runbook, with the error-message table",
  agentDownload: "Download the source agent",
} as const;

export const BRIDGE = {
  title: "Learn the connection by making it.",
  text: "Follow one read from an MCP client to the source it came from.",
  href: to("journal-mcp"),
  label: "Read the connection guide",
} as const;

export const FINAL = {
  title: "Build your first World.",
  cta: { href: to("studio"), label: "Studio" },
} as const;

/** Every page route the page links to, for the guard test. */
export const CONNECT_DESTINATIONS: readonly Route[] = [
  HERO.primary.href, HERO.secondary.href, WORKSPACE_HREF, EXPLORE_HREF, to("contact"), BRIDGE.href, FINAL.cta.href,
];
