import type { ArticleSource } from "@/components/v34/ui/article-layout";

/**
 * The Model Context Protocol specification, at the revision the TAVONEL server speaks. Each entry
 * names the revision it cites, so a reader checks the same text the article relied on.
 */
export const MCP_SOURCES: readonly ArticleSource[] = [
  {
    label: "Model Context Protocol specification, revision 2025-06-18",
    href: "https://modelcontextprotocol.io/specification/2025-06-18",
    note: "The protocol overview: clients, servers and the context a server provides.",
  },
  {
    label: "MCP specification, Tools, revision 2025-06-18",
    href: "https://modelcontextprotocol.io/specification/2025-06-18/server/tools",
    note: "How a server exposes tools and how a client discovers and calls them.",
  },
  {
    label: "MCP specification, Transports, revision 2025-06-18",
    href: "https://modelcontextprotocol.io/specification/2025-06-18/basic/transports",
    note: "The stdio transport, where a client launches the server as a local process, and the HTTP transport for remote servers.",
  },
  {
    label: "MCP specification, Authorization, revision 2025-06-18",
    href: "https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization",
    note: "The authorization profile for servers reached over HTTP.",
  },
];
