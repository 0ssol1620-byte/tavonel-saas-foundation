# TAVONEL developer access

Create a scoped key in **Workspace > Developers**. The plaintext token is shown
once. TAVONEL stores only its SHA-256 digest.

## Install: fetch, then check the bytes

There is no npm, pip or Homebrew package. Six files are published at
`https://tavonel.com/developer/`, and `channel.json` names the exact SHA-256 of
each one. Installing is downloading a file and checking its digest; nothing is
written to a registry, a PATH or a profile.

```bash
curl -fsS https://tavonel.com/developer/channel.json -o channel.json
jq -r '.assets | to_entries[] | "\(.value.sha256 | sub("^sha256:";"")) *\(.value.url | split("/") | last)"' \
  channel.json > channel.sha256
jq -r '.assets[].url' channel.json | xargs -n1 curl -fsS -O
sha256sum --check channel.sha256
```

`sha256sum` prints one `OK` line per asset. A `FAILED` line means the bytes you
received are not the bytes the channel names: delete the file and do not run it.

```powershell
$channel = Invoke-RestMethod https://tavonel.com/developer/channel.json
foreach ($asset in $channel.assets.PSObject.Properties.Value) {
  $name = Split-Path $asset.url -Leaf
  Invoke-WebRequest $asset.url -OutFile $name
  $actual = "sha256:" + (Get-FileHash $name -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $asset.sha256) { Remove-Item $name; throw "$name does not match $($asset.sha256)" }
  "$name OK"
}
"pinned version: $($channel.version)"
```

**Pin.** `node tavonel-cli.mjs --version` prints the distribution version
compiled into the file you hold; keep the file and its digest and you are
pinned. Nothing self-updates.

**Update.** `node tavonel-cli.mjs update-check` compares your version with
`channel.json` and prints the difference. It never downloads and never
overwrites: updating is the install above, run again.

**Uninstall.** Delete the files. The only state any of them writes is the
connector cursor file you name yourself with `--state`.

**Runtimes.** Node.js 20 or newer for the four `.mjs` files; Python 3.12 or
newer for `tavonel-source-agent.py` and `tavonel-verify-roundtrip.py`. None of
them has a required dependency: `boto3` is needed only for the agent S3 mode
below, and `rdflib` only makes the round-trip checker strict about Turtle -- its
absence is reported as a check that did not run, never as one that passed.

## CLI

```powershell
$env:TAVONEL_API_KEY = "tvnl_live_..."
node .\tavonel-cli.mjs documents
node .\tavonel-cli.mjs world collection-...
node .\tavonel-cli.mjs update-check
```

API requests are pinned to `/api/v1` and advertise the v1 media type.

The download command creates a new file and refuses to overwrite an existing
path. Verify the ZIP with the offline verifiers below before importing it.

## Offline verifiers

Three separate questions, three files, none of which reads a network.

```bash
# Is this archive intact, and signed by the key we publish?
# The fingerprint comes from the trust endpoint, not from the archive.
fingerprint=$(curl -fsS https://tavonel.com/api/export/trust | jq -r .publicKeySpkiSha256)
node tavonel-verify-export.mjs --archive world.zip --trusted-fingerprint "$fingerprint"

# Is what is inside it a coherent Compiled World?
node tavonel-verify-package.mjs --package world.zip --require-signature

# Do the ids and the provenance survive a load by something that is not ours?
python tavonel-verify-roundtrip.py --package world.zip
```

`--package` also accepts an extracted directory or a candidate artifact JSON.
`--json` makes each of them print a machine-readable report. All three exit
non-zero on any failure, and the package validator exits 2 rather than 0 when
its arguments are wrong, so a mistyped command is never a silent pass.

All three are the files this repository runs in its own tests, published
byte-for-byte rather than ported, and pinned in `channel.json`.

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

The MCP surface is permanently read-only. Nine tools:

| Tool | Returns |
| --- | --- |
| `list_sources` | The workspace's documents, with processing state and version key. |
| `list_worlds` | The workspace's active Compiled Worlds, with manifest digest and revision. Pass `limit` (1-50) and `cursor` to page. |
| `get_world` | One Compiled World: status, contract, freshness, objects, relations, evidence, history. |
| `search_world` | Retrieved regions with provenance and ranks. No generated prose. |
| `ask_world` | A grounded answer with citations, or an abstention. |
| `get_object` | The objects lens, or one object by stable id. Pass `limit` and `cursor` to page a large World. |
| `get_relation` | The relations lens, or one relation by stable id. Pages the same way. |
| `get_evidence` | Every region with its source version, page and bbox in the 0-1000 page frame. Pages the same way. |
| `download_package` | Where the signed package is, its size, its manifest digest and signing key. |

There is no upload, compile, connector mutation, promotion, rollback, billing or
key-management tool, and the server refuses to start if one is ever added to it:
promotion is the moment a candidate becomes the World an organisation answers
from, and it stays with a person in a browser.

`list_worlds` lists only **active** Worlds. A candidate nobody promoted is not
what this workspace answers from, and a discovery list mixing the two would hand
an agent a set in which some entries are organizational truth and some are not.
The tool was absent until this release because the API had no endpoint that
listed a workspace's collections; `GET /api/v1/collections` is that endpoint.

On the lens tools, omitting `limit` still returns the whole lens, so nothing that
worked before pages differently now. An id and a page cannot be combined: the id
is selected from the response, so a paged request plus an id would report
`NOT_FOUND` for an item sitting on a later page. Ask for the id, or walk the
pages.

`download_package` returns a descriptor rather than the archive: the bytes are
fetched over HTTPS with the same key and checked with the offline verifier, which
is better than base64ing tens of megabytes through a pipe to deliver something
the caller must verify anyway.

Before registering it, run the built-in check:

```bash
TAVONEL_API_KEY=tvnl_live_... node tavonel-mcp.mjs --doctor
```

It verifies the key with one authenticated read, compares this file's build
against the published channel, lists your active Worlds, and prints `PASS`/`FAIL`
per check with what to do about the first failure. It exits non-zero when a check
fails, and it performs reads only -- through the same tool table and the same
read-only gate the server starts behind.

Tool names changed in release 2026.9.3.1. `list_documents`, `get_collection`,
`get_active_world` and `ask_active_world` are now `list_sources`, `get_world` and
`ask_world`, alongside five tools that did not exist before. Pin the release you
registered and read this table before updating.

Run `node tavonel-mcp.mjs --version` before registration to record the exact
distribution. Update only from the HTTPS URLs and SHA-256 values in the public
distribution channel.

## Connector agent

Download `tavonel-source-agent.py`. It requires Python 3.12 or newer. Create a
key scoped to `connections:sync` and `documents:intake`; add
`connections:read` only when the same key also needs inventory access. The key
is read from `TAVONEL_API_KEY` only and never from a command argument.

Mounted SMB, NFS, and SFTP filesystems use the local agent and operating-system
credentials. S3, R2, and MinIO use the same agent with an existing AWS profile,
workload role, or provider environment. Credential values are rejected by the
API and database. The schema reserves external secret references for a future
managed worker, but the production UI does not expose that path until a worker
is deployed and qualified.

```powershell
$env:TAVONEL_API_KEY = "tvnl_live_..."
python .\tavonel-source-agent.py `
  --root "Z:\Research" `
  --connection-id "00000000-0000-0000-0000-000000000000" `
  --state "$env:LOCALAPPDATA\TAVONEL\research-share.json"
```

S3-compatible mode additionally requires `boto3`. Use `--s3-bucket`,
`--s3-prefix`, `--s3-region`, and, for R2 or MinIO, an HTTPS
`--s3-endpoint-url`. The agent uses the normal AWS credential provider chain;
do not place cloud keys in TAVONEL connection configuration.

Every sync sends a bounded metadata-only event manifest, its canonical SHA-256,
and an expected previous cursor digest. Cursor conflicts fail closed with HTTP
409. Source bytes use separate short-lived browser/agent-direct R2 capabilities;
they do not travel through the application server.

## Managed OAuth connectors

Google Drive, Dropbox, and Microsoft OneDrive/SharePoint use browser-session
OAuth under `/api/v1/oauth-connectors`. OAuth client secrets, PKCE verifiers,
and refresh tokens must be held by the configured managed secret broker. The
database stores only one-way state digests and opaque `vercel://`, `aws-sm://`,
`gcp-sm://`, `azure-kv://`, or `vault://` references. If any provider client,
secret reference, public HTTPS origin, or broker credential is missing, the
authorization route fails closed and does not return a provider URL.

The cloud-pull adapter normalizes Google Drive pagination, Dropbox recursive
cursors, and Microsoft Graph delta links into the same bounded source-item
contract. Graph continuation URLs are accepted only from
`graph.microsoft.com`; SharePoint uses an explicit drive ID. Supported native
Google documents are exported to PDF, XLSX, PPTX, or PNG, while unsupported
native types fail closed rather than returning ambiguous bytes.

## API key rotation and audit

Rotate keys with `POST /api/v1/developer/keys/{id}/rotate` from an authenticated
browser session. The replacement token is shown once. Creation of the new key,
revocation of the old key, and the `api_key_rotated` audit event commit in one
database transaction. Read the tenant audit trail from
`GET /api/v1/developer/audit`; API keys cannot call either management endpoint.
