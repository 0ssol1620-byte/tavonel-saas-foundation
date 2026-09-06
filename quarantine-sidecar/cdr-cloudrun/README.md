# TAVONEL Cloud Run PDF-Raster CDR

## Purpose and activation state

This directory contains a **format-changing Content Disarm and Reconstruction (CDR) service** for the isolated TAVONEL SaaS Foundation. It is an alternative to a managed CDR vendor when customer documents must remain in the APAC deployment boundary. The service accepts a source only after the Cloudflare quarantine sidecar supplies an independent HMAC, short-lived timestamp, request ID, and source SHA-256. It converts qualified Office inputs to PDF with LibreOffice, rasterizes every page with PyMuPDF, and returns a newly created image-only PDF.

The service is designed for **Google Cloud Run first generation in `asia-northeast3` (Seoul)**. First generation Cloud Run uses gVisor as its container sandbox, while Cloud Run resource data is stored in the selected region. [1] [2] A source-built Cloud Run revision is deployed but has no runtime HMAC configured, so the CDR service itself returns structured fail-closed `503` responses. The active Cloudflare Worker has no CDR runtime configuration and remains HTTP 503 fail-closed; it cannot accept or process customer bytes.

> The PDF-raster pathway intentionally changes every approved source into `application/pdf`. This removes active document content and source metadata but does not preserve editable Office structure, native HWP/HWPX, archives, or original rendering guarantees. Downstream OCR must operate on the reconstructed PDF only.

## Qualified and rejected formats

| Source category | Qualified by this adapter | Sanitized output | Reason |
|---|---:|---|---|
| PDF | Yes | Image-only PDF | Direct page render and rebuild |
| DOCX, XLSX, PPTX, ODT/ODS/ODP | Yes, subject to package inspection | Image-only PDF | LibreOffice conversion, then page rebuild |
| Legacy DOC/XLS/PPT | No | — | Binary Office macro/password safety is not empirically qualified in this exact container |
| JPEG, PNG, TIFF, GIF | Yes | Image-only PDF | Image renderer, then page rebuild |
| HWP/HWPX | No | — | Not yet empirically qualified in this exact container image |
| ZIP/archive | No | — | Archive expansion requires a separate bounded, per-entry CDR design |
| Executables, scripts, HTML, password-protected PDFs, macro/embedded-object Office packages, or unsupported files | No | — | Rejected before renderer invocation or conversion |

The service accepts at most **5 MiB original input**, **80 pages**, **30 million rendered pixels per page**, **80 million rendered pixels total**, and **18 MiB reconstructed output**. The Cloudflare sidecar enforces the same 5 MiB ceiling and format allowlist before it can mint a browser-to-R2 upload URL for this provider. Any failure leaves the original in quarantine and creates no immutable approval.

## Security contract

The sidecar posts to `/v1/disarm` using multipart field `source` and these headers:

| Header | Contract |
|---|---|
| `x-tavonel-input-sha256` | `sha256:<lowercase-hex>` digest of the original browser upload |
| `x-tavonel-cdr-timestamp` | ISO-8601 UTC timestamp, accepted only within 300 seconds |
| `x-tavonel-cdr-request-id` | 16–160 character unique token |
| `x-tavonel-cdr-signature` | Unpadded base64url HMAC-SHA256 of `timestamp.requestId.inputSha256` using `TAVONEL_CDR_HMAC` |

The service recomputes the streamed upload digest before rendering. A mismatch, invalid HMAC, expired request, duplicate request ID within the live instance, unsupported MIME/extension pair, macro/embedded Office package, input limit, conversion failure, rendering-budget breach, or output limit yields no clean verdict. All error and health responses use `cache-control: no-store`. It returns a raw PDF only with all of the following response headers:

| Response header | Required value |
|---|---|
| `content-type` | `application/pdf` |
| `x-tavonel-cdr-status` | `clean` |
| `x-tavonel-input-sha256` | Exact original input digest |
| `x-tavonel-cdr-output-mime` | `application/pdf` |
| `x-tavonel-cdr-output-sha256` | Exact digest of returned reconstructed PDF |
| `x-tavonel-malware-scan` | Scanner verdict bound to the input digest, see "Malware scanning" |
| `cache-control` | `no-store` |

The sidecar independently verifies every header, computes the output digest again, scans the reconstructed PDF with ClamAV, and only then stores the sanitized bytes under the immutable tenant prefix. It records both original and sanitized MIME/digest metadata. Candidate OCR output is still not an active knowledge world.

Cloud Run terminates HTTPS before the container, so direct end-to-end mTLS is not a property of this deployment. The enforced caller gate is the independent, short-lived HMAC contract above. A process-local guard rejects duplicate request IDs for 300 seconds while the sole CDR instance remains alive; it is **not durable across a Cloud Run restart**, so the public endpoint retains a bounded replay residual risk if an authenticated request were captured. Cloud Run's own IAM service-to-service authentication would require the Cloudflare caller to obtain a Google-signed ID token through secure federation or a long-lived service-account key; neither is introduced by this path because a downloaded service-account key is a security risk. [3]

## Local evidence

The following tests have passed against the local `linux/amd64` Docker image built from this directory. All fixtures are harmless PDFs or synthetic byte strings; no customer data or production secret is used.

```bash
sudo docker build --network=host -t tavonel-pdf-raster-cdr:local .
sudo docker run --rm --network host \
  -e TAVONEL_CDR_HMAC=fixture-cdr-hmac-secret-that-is-long-enough-123 \
  -v "$PWD/tests:/tests:ro" \
  tavonel-pdf-raster-cdr:local \
  python -m unittest discover -v -s /tests
```

The container suite verifies structured no-store health and disarm failure with no HMAC, invalid HMAC rejection, duplicate authenticated-request rejection, source digest mismatch rejection, ZIP rejection, macro-bearing OOXML rejection, legacy binary Office rejection, and successful creation of a text-free image-only PDF with exact output digest. The sidecar contract suite separately verifies provider HMAC generation, output MIME/digest binding, 5 MiB and archive pre-upload rejection, and legacy generic/Cloudmersive fail-closed behavior.

## Deployment gate for Google Cloud Run

The isolated Foundation target has not yet enabled its Cloud Run API or configured billing. A future deployment requires user approval because it creates external Cloud Run, Cloud Build, Artifact Registry, and potentially billed resources. No production or customer key belongs in source control, shell history, image layers, browser storage, or application logs.

The Foundation deployment needs a dedicated, server-only `TAVONEL_CDR_HMAC` value stored in Foundation Google Secret Manager and mirrored as a separate Foundation Cloudflare Worker secret. It must not reuse the sidecar HMAC and must never be printed. The synthetic service should use these settings:

| Setting | Required production value |
|---|---|
| Region | `asia-northeast3` (Seoul) |
| Execution environment | First generation (gVisor sandbox) |
| Authentication/ingress | Public Cloud Run endpoint only because Cloudflare cannot currently mint Google IAM identity tokens; strict app HMAC remains mandatory |
| Scaling | min instances `0`, max instances `1`, concurrency `1` |
| Resources | 1 vCPU, 2 GiB memory, 120 second request timeout |
| Logging | No application access log; never log multipart content, name, digest, or authentication headers |
| Egress | Initial synthetic service has no app-level outbound calls but is not yet network-denied; Direct VPC `all-traffic` with **no Cloud NAT** is a separately approved hardening step because it creates network resources |
| Health endpoint | `GET /health`, expected JSON `{"status":"ok", ...}` only after HMAC and renderer are available; do not use paths ending in `z`, which Cloud Run reserves |

Cloud Run allows public `run.app` ingress at the network layer when configured as `all`; its documentation recommends layering ingress restrictions with authentication. [4] Because no Google IAM caller identity exists for the Cloudflare Worker, the initial public endpoint is bounded by the application HMAC, short expiry, digest binding, source-size cap, single-instance/single-concurrency cap, in-process duplicate rejection, and no application access log. It retains bounded replay and outbound-egress residual risks until a federated IAM caller and approved network egress controls are implemented. This route must be rejected if a formal network-private caller identity becomes a requirement.

Before configuring the Cloudflare sidecar with the production CDR URL, verify all items below using only a harmless fixture:

1. The Cloud Run service is in `asia-northeast3`, first generation, with max instances `1`, concurrency `1`, and no application access log. Any Direct VPC/no-NAT egress control is treated as a separate approved hardening action, not assumed present.
2. `/health` returns `status: ok` only with the server-side secret configured; `/v1/disarm` rejects any missing/expired/bad HMAC before rendering.
3. A qualified 5 MiB-or-smaller fixture returns a sanitized PDF with exact response headers and zero extractable source text; a ZIP, HWP/HWPX, legacy DOC/XLS/PPT, macro/embedded OOXML/ODF, password-protected PDF, oversize, malformed PDF, HMAC mismatch, duplicate request ID, and digest mismatch are rejected.
4. The Cloudflare sidecar validates the Cloud Run result, re-scans the reconstructed PDF with ClamAV, writes a sanitized immutable object, and retains original input digest as lineage only.
5. Every test fixture and temporary immutable/quarantine object is deleted after evidence is recorded.

After this synthetic qualification, add `TAVONEL_CDR_PROVIDER=tavonel_pdf_raster`, `TAVONEL_CDR_URL`, `TAVONEL_CDR_HEALTH_URL`, and the separate CDR HMAC as server-only Worker secrets. Vercel direct intake remains disabled until the full R2/sidecar synthetic path succeeds. RunPod remains disabled until independently approved release evidence, endpoint qualification, and callback tests succeed.

## Malware scanning

CDR is not antivirus: rasterizing a document removes active content, but it never says whether the
source was malicious. The service therefore scans the source with ClamAV **after** the authenticated
digest is confirmed and **before** anything parses it — the Office package guard, LibreOffice and the
renderer all run only once a verdict exists.

`malware.py` is a port of the Core API adapter `services/api/src/akc_api/malware.py` (SHA `e03d5bf`),
so both services refuse with the same vocabulary. It uses the standard library only; clamd's INSTREAM
protocol is four socket writes and a client library would add a dependency to the hostile-data path.

### Outcomes

| Condition | HTTP | `detail.code` | Written |
|---|---:|---|---|
| Signature hit | 422 | `MALWARE_DETECTED` (with `signature`, `scannedSha256`) | nothing |
| clamd unreachable, or required and unconfigured | 503 | `SCANNER_UNAVAILABLE` | nothing |
| clamd took the bytes and did not answer inside the read budget | 503 | `SCAN_TIMEOUT` | nothing |
| Reply undecodable, or carried no verdict | 503 | `SCANNER_INVALID_RESPONSE` | nothing |
| Clean | 200 | — | sanitized PDF |

A clean response adds one header to the existing set:

| Response header | Required value |
|---|---|
| `x-tavonel-malware-scan` | Compact JSON `{"engine","signatureVersion","scannedSha256","verdict","durationMs"}` |

`scannedSha256` is the digest the caller authenticated, so the verdict is bound to the exact bytes —
and hence to the SourceVersion the Worker records — rather than being a claim that floats beside them.
`/health` reports `scannerReady`, and returns 503 when scanning is required and the scanner cannot be
pinged, because an instance that would refuse every request is not healthy.

There is no path from a scanner error to a clean verdict. Once a host is configured, every error
raises, whatever `MALWARE_SCAN_REQUIRED` says; the flag only decides what happens when **no** scanner
is configured at all — refuse (`1`, the default and the production value) or return the explicit
non-verdict `{"verdict":"not_scanned","engine":"none"}` (`0`, local development and the suites that
have no clamd). `not_scanned` is never reported as `clean`.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MALWARE_SCAN_REQUIRED` | `1` | Anything but the exact string `0` means required |
| `CLAMD_HOST` / `CLAMD_PORT` | — / `3310` | TCP clamd; localhost in the sidecar deployment |
| `CLAMD_SOCKET` | — | Unix socket path; takes precedence over host/port |
| `CLAMD_CONNECT_TIMEOUT_SECONDS` | `3` | Connect budget; exceeded ⇒ `SCANNER_UNAVAILABLE` |
| `CLAMD_READ_TIMEOUT_SECONDS` | `20` | Reply budget; exceeded ⇒ `SCAN_TIMEOUT` |
| `CLAMD_CHUNK_BYTES` | `1048576` | INSTREAM chunk size |

A value that cannot be a positive number is a refusal, not a silently restored default.

### The sidecar image and its licence

`service.yaml` pins `clamav/clamav:1.5.4` by tag **and** by index digest
`sha256:f0954d679017eb6d48221e2b2be3ac5457bf278a844f39b672376f55a085f591`, observed 2026-09-06.
ClamAV 1.5.4 is **GPL-2.0-only with an OpenSSL linking exception**. It runs as a separate process and
is reached over its documented socket protocol; `libclamav` is not linked into any TAVONEL binary.
That is the ClamAV project's own daemon architecture, not a workaround — but note that no official
ClamAV or FSF statement endorsing this reading for this use case was found, so the licence-scope
conclusion itself is recorded as unconfirmed in
`research/RECEIPT_MALWARE_SCANNING_2026-09-06.md`, which is the source for every fact in this section.

### Scan limits against the intake ceiling

The intake ceiling is `MAX_INPUT_BYTES` = 5 MiB, enforced by `copy_and_digest` and by the Cloudflare
sidecar before an upload URL is minted. The stock `clamd.conf` shipped in the image is above it by
two orders of magnitude, so no override is deployed:

| Option | ClamAV default | Intake ceiling | Headroom |
|---|---:|---:|---|
| `StreamMaxLength` | 100 MB | 5 MiB | 19× — the INSTREAM connection is never closed for size |
| `MaxFileSize` | 100 MB | 5 MiB | 19× — no member of an accepted package goes unscanned for size |
| `MaxScanSize` | 400 MB | 5 MiB | 76× — total recursively extracted data |
| `MaxRecursion` | 17 | ≤ 2 (PDF, or one OOXML/ODF ZIP layer) | 8× |

This is asserted empirically, not assumed: the qualification job scans a 4.9 MiB fixture — just under
the ceiling — and requires a clean verdict, which fails loudly if any stream limit is ever lowered
beneath the intake ceiling. **If the 5 MiB ceiling is ever raised past 100 MB, or archive inputs are
ever qualified, `StreamMaxLength`, `MaxFileSize` and `MaxRecursion` must be set explicitly in a
mounted `clamd.conf` before the raise ships** — otherwise a crafted container can pass unscanned data
through silently, which is the exact failure the research receipt flags.

### Egress, signatures and the sidecar tag

The signature database is baked into the pinned tag, and `service.yaml` disables `freshclam`
(`CLAMAV_NO_FRESHCLAMD`) because the revision is deployed with all traffic pinned to a VPC with no
Cloud NAT: a daemon that cannot reach `database.clamav.net` would fail every two hours and log noise
instead of refreshing anything. The consequence is explicit and must not be described away:

- **Signature freshness equals the age of the pinned image.** A redeploy with a newly observed digest
  is the only refresh mechanism in this configuration. The alternative — allowing egress to the
  ClamAV mirrors — is a network decision for the founder, and even then the project default is 12
  checks a day, i.e. up to ~2 h of signature lag.
- The engine and signature version of the running sidecar are reported on every clean scan
  (`signatureVersion`), so a stale scanner is visible in the receipt rather than invisible.
- If the VPC network and connector do not exist yet, the two network annotations must be removed
  before applying, and the revision then has ordinary Cloud Run egress.

### Deploying this definition

Not an agent action. Applying it is a production deploy, and it belongs to the founder:

```bash
# Build and push the CDR image first, then substitute both placeholders.
gcloud run services replace service.yaml \
  --project "<PROJECT_ID>" --region asia-northeast3
```

The definition is `IMPLEMENTED_NOT_LIVE`: it has never been applied, so nothing here is qualified on a
real Cloud Run revision. The evidence that exists is the container qualification job
`.github/workflows/malware-scan-qualification.yml`, which runs the same adapter against a real
`clamd` of the pinned tag on every push.

## References

[1]: https://cloud.google.com/run/docs/locations "Cloud Run locations"
[2]: https://cloud.google.com/run/docs/container-contract "Cloud Run container runtime contract"
[3]: https://cloud.google.com/run/docs/authenticating/service-to-service "Cloud Run service-to-service authentication"
[4]: https://cloud.google.com/run/docs/securing/ingress "Restrict network endpoint ingress for Cloud Run"
[5]: https://cloud.google.com/run/docs/known-issues#reserved_url_paths "Cloud Run reserved URL paths"
