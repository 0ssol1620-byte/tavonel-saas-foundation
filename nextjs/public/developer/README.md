# TAVONEL developer access

Create a scoped key in **Workspace > Developers**. The plaintext token is shown
once. TAVONEL stores only its SHA-256 digest.

## CLI

Requires Node.js 20 or newer.

```powershell
$env:TAVONEL_API_KEY = "tvnl_live_..."
node .\tavonel-cli.mjs documents
node .\tavonel-cli.mjs world collection-...
```

The download command creates a new file and refuses to overwrite an existing
path. Verify the ZIP with the bundled offline verifier before importing it.

## Read-only MCP

Download `tavonel-mcp.mjs`, then register it as a stdio server. Keep the key in
the MCP client's environment or secret facility, not in the command arguments.

```json
{
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
}
```

The MCP surface is permanently read-only: document inventory, candidate package,
active world, and grounded Ask. It has no upload, compile, connector mutation,
promotion, rollback, billing, or key-management tool.

## Connector agent

Mounted SMB, NFS, and SFTP filesystems use the local agent and operating-system
credentials. S3, R2, and MinIO use the same agent with an existing AWS profile,
workload role, or provider environment. Credential values are rejected by the
API and database. The schema reserves external secret references for a future
managed worker, but the production UI does not expose that path until a worker
is deployed and qualified.

Every sync sends a bounded metadata-only event manifest, its canonical SHA-256,
and an expected previous cursor digest. Cursor conflicts fail closed with HTTP
409. Source bytes use separate short-lived browser/agent-direct R2 capabilities;
they do not travel through the application server.
