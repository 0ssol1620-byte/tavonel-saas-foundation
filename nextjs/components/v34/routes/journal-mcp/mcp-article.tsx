import type { Route } from "next";
import V34Page from "@/components/v34/shell/v34-page";
import RouteJsonLd from "@/components/v34/shell/route-json-ld";
import { ArticleLayout, type ArticleBlock } from "@/components/v34/ui/article-layout";
import { FinalCta } from "@/components/v34/ui/final-cta";
import { Figure } from "@/components/v34/ui/figure";
import { ToolList } from "@/components/v34/ui/tool-list";
import { MCP_TOOL_COUNT_WORD } from "@/lib/mcp-tools";
import { v34Route } from "@/lib/v34/routes";
import { articleDates } from "../journal/article-dates";
import { McpCover } from "../journal/covers";
import { ReadNext } from "../journal/read-next";
import { ConfigBlock } from "./config-block";
import { MCP_SOURCES } from "./mcp-sources";

/*
  How an AI client reads a World through MCP. The product facts come from the MCP docs page and the
  published stdio server (public/developer/tavonel-mcp.mjs): its tools are `MCP_TOOLS`, printed by
  `ToolList`, and its count is spelled from that list. The article describes the local stdio
  connection and the integrator's checks; the hosted endpoint and any directory listing are left to
  the pages that can state their status.
*/

const ROUTE = "journal-mcp";
const record = v34Route(ROUTE);
/** A retained page that is not in the registry: the guard test checks that its page file exists. */
const retained = (path: string) => path as Route;

export const MCP_DEK = "A permission-aware integration starts with a small read and widens only as far as the key allows.";

/** The one client-side object every stdio MCP client accepts, as the MCP docs page prints it. */
const CLIENT_CONFIG = [
  "{",
  '  "mcpServers": {',
  '    "tavonel": {',
  '      "command": "node",',
  '      "args": ["/absolute/path/to/tavonel-mcp.mjs"],',
  '      "env": {',
  '        "TAVONEL_API_KEY": "your key, scoped to reads",',
  '        "TAVONEL_BASE_URL": "https://tavonel.com"',
  "      }",
  "    }",
  "  }",
  "}",
].join("\n");

export const MCP_BLOCKS: readonly ArticleBlock[] = [
  { kind: "h2", text: "What MCP connects" },
  { kind: "p", text: "The Model Context Protocol gives compatible AI clients a standard way to discover tools and call them to obtain context. The protocol carries the request, and the server behind it decides what that request may read. Access control belongs to the server and the knowledge store, so a client is only as permitted as the key it presents." },
  { kind: "h2", text: "The tools a client gets" },
  { kind: "p", text: `The TAVONEL server offers ${MCP_TOOL_COUNT_WORD} read-only tools. They list sources and Worlds, search and ask a World, and return objects, relations and evidence with their provenance, plus a descriptor of the signed package.` },
  { kind: "figure", node: <ToolList /> },
  { kind: "p", text: "Every tool reads. Activation, the moment a candidate becomes the World an organization answers from, stays with a person in a browser, and the server refuses to start if a tool that writes is ever added to it." },
  { kind: "h2", text: "Connect a client over stdio" },
  { kind: "p", text: "The server is published on the developers page as a single file with no dependencies and no build step, pinned by digest in the channel manifest, so it can be read before it is pointed at anything. Download it, check it against the pinned digest, set an API key, and run it with its doctor flag: that checks the key, the pin and one real read, and names whichever of the three is wrong. Then register it with the client." },
  { kind: "figure", node: <Figure kind="Configuration steps" framed={false} art={<ConfigBlock label="Client configuration for the TAVONEL stdio server" text={CLIENT_CONFIG} />} caption="Registering the server with a stdio client." /> },
  { kind: "p", text: "Keep the key in the client's env block or its secret facility, because arguments show up in process listings. Give it a key scoped to reads and nothing else." },
  { kind: "h2", text: "Make the smallest useful call" },
  { kind: "list", items: [
    "List the active Worlds the key can see, and pick a public or authorized sample. Confirm its licence and revision first, and keep customer documents out of a first test.",
    "Search that World. The result is retrieved regions with provenance and ranks, with no generated prose.",
    "Fetch the evidence for one result and compare the source version, the page and the region with what the search returned.",
    "Ask a question once those match, and read the citations or the abstention that comes back.",
  ] },
  { kind: "h2", text: "Scope, denial and revocation" },
  { kind: "p", text: "Create a least-privilege API key for the connection, and revoke it from the workspace's developer settings when the connection ends. Test that boundary on purpose. Present a key from one workspace with the identifier of another workspace's World, and present a key after it was revoked. Check what each response reveals as well as whether it refuses." },
  { kind: "h2", text: "Treat retrieved text as evidence" },
  { kind: "p", text: "A source document can contain text that tells an assistant to ignore its instructions, reveal a credential or make a network request. That text is part of the document. A client should show it as quoted evidence with its source, and should keep a retrieved passage from changing what the assistant is permitted to do. Read tools leave a World as it was, so a passage cannot become a write." },
  { kind: "h2", text: "Failures worth testing" },
  { kind: "list", items: [
    "A valid key for World A is presented with the identifier of World B.",
    "A revision that was accessible is withdrawn after a result was cached.",
    "A result exceeds the host's output limit, or a request times out.",
    "The user disconnects the integration while a second request is in flight.",
  ] },
  { kind: "p", text: "For each case, decide the expected status, the fields returned and the audit event before the integration tests begin, and keep document contents and bearer tokens out of the logs. A client-side error screen shows what the user saw. Only a server-side check shows that the data was protected." },
  { kind: "h2", text: "Choose a connection with the specification open" },
  { kind: "p", text: "Read the specification revision your host implements, for its transports and its authorization profile. A local stdio server and a remote server are different paths with different authorization, so confirm which one the release you use supports, and record the supported operations, the scope, the revocation path and the host version you tested." },
  {
    kind: "figure",
    node: (
      <ReadNext
        label="Read next"
        links={[
          { href: v34Route("connect").path, label: "Connect an AI client" },
          { href: v34Route("developers").path, label: "The developer contract" },
          { href: retained("/docs/mcp"), label: "MCP reference" },
          { href: retained("/changelog"), label: "Changelog" },
        ]}
      />
    ),
  },
];

/** The article and its closing strip, without the V34 frame, so it can be rendered on its own. */
export function McpBody({ published, modified }: { published: string; modified: string }) {
  return (
    <>
      <ArticleLayout
        title={record.heading}
        dek={MCP_DEK}
        published={published}
        modified={modified}
        breadcrumb={[{ href: v34Route("home").path, label: "Home" }, { href: v34Route("journal").path, label: v34Route("journal").ogLabel }]}
        cover={<Figure art={<McpCover />} caption="A client reaches a World through the scope its key grants, and the key can be revoked." />}
        blocks={MCP_BLOCKS}
        sources={MCP_SOURCES}
      />
      <FinalCta
        title="Continue learning."
        cta={{ href: v34Route("developers").path, label: "Open the developer contract" }}
        secondary={{ href: v34Route("journal").path, label: "All field guides →" }}
      />
    </>
  );
}

/** The page body, inside the V34 frame. */
export default function McpArticle() {
  return (
    <V34Page route={ROUTE}>
      <RouteJsonLd route={ROUTE} />
      <McpBody {...articleDates(ROUTE)} />
    </V34Page>
  );
}
