/**
 * The first API call, as `/developers` prints it. The landing page shows the same two lines, from
 * this one string, so the two cannot drift.
 */
export const FIRST_CALL = `curl -H "Authorization: Bearer $TAVONEL_API_KEY" \\
  https://tavonel.com/api/v1/documents`;

/*
  Gap #7 (V-7). The same first read, in the four ways a developer actually arrives.

  One cURL block told a Python reader and an agent author to translate it themselves, which is
  the gap every comparable page closes with tabs. What this file does not do is invent an SDK to
  make the tabs look richer: there is no npm or PyPI package -- `lib/docs-content.ts` says so in
  its own words -- so the HTTP tabs use each language's standard library, and the fourth tab is
  the MCP server this repository actually publishes, registered by absolute path.

  Every identifier below is copied from the thing that implements it, and held there by
  `developer-snippets.test.ts`, which reads the OpenAPI document this deployment serves and the
  MCP server's own `TOOLS` table rather than a list retyped in the test:

    - the path and the scope are `GET /api/v1/documents`
    - `workspaceId`, `documents`, `documentId`, `state` and `sourceVersionKey` are that
      operation's documented response
    - `list_sources` and its empty input schema are `public/developer/tavonel-mcp.mjs`

  A field nobody returns cannot be printed here, which is the point of generating the tabs from
  the schemas instead of writing four plausible samples.
*/

const TYPESCRIPT_FIRST_CALL = `const response = await fetch("https://tavonel.com/api/v1/documents", {
  headers: { Authorization: \`Bearer \${process.env.TAVONEL_API_KEY}\` },
});
if (!response.ok) {
  const { code } = await response.json();
  throw new Error(\`tavonel_read_refused: \${code}\`);
}

const { workspaceId, documents } = await response.json();
for (const document of documents) {
  console.log(workspaceId, document.documentId, document.state, document.sourceVersionKey);
}`;

const PYTHON_FIRST_CALL = `import json
import os
import urllib.request

request = urllib.request.Request(
    "https://tavonel.com/api/v1/documents",
    headers={"Authorization": f"Bearer {os.environ['TAVONEL_API_KEY']}"},
)
with urllib.request.urlopen(request) as response:
    body = json.load(response)

for document in body["documents"]:
    print(body["workspaceId"], document["documentId"], document["state"], document["sourceVersionKey"])`;

const MCP_FIRST_CALL = `{
  "mcpServers": {
    "tavonel": {
      "command": "node",
      "args": ["C:/absolute/path/tavonel-mcp.mjs"],
      "env": {
        "TAVONEL_API_KEY": "tvnl_live_...",
        "TAVONEL_BASE_URL": "https://tavonel.com"
      }
    }
  }
}`;

/** The four tabs `/developers` renders, cURL first because it is the one with no prerequisite. */
export const FIRST_CALL_SNIPPETS: ReadonlyArray<{ language: string; label: string; body: string }> = [
  { language: "bash", label: "cURL", body: FIRST_CALL },
  { language: "typescript", label: "TypeScript", body: TYPESCRIPT_FIRST_CALL },
  { language: "python", label: "Python", body: PYTHON_FIRST_CALL },
  { language: "json", label: "MCP", body: MCP_FIRST_CALL },
];

/** The operation every tab performs, named once for the test that checks them against it. */
export const FIRST_CALL_OPERATION = {
  path: "/documents",
  method: "get",
  scope: "documents:read",
  /** The agent tab reaches the same operation through this tool rather than through HTTP. */
  mcpTool: "list_sources",
  /** The response fields the samples read. Each one is required by the documented schema. */
  fields: ["workspaceId", "documents", "documentId", "state", "sourceVersionKey"],
} as const;
