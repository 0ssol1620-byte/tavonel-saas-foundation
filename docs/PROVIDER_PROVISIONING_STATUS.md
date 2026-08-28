# Provider Provisioning Status

## Supabase Seoul foundation

On 2026-08-27, a dedicated project named `tavonel-saas-foundation` was created in the `Phillip's projects` organization through the authenticated provider integration. Its immutable project reference is `tfcorhjkqcuisqhsjemz`; its selected region is **Northeast Asia (Seoul) / `ap-northeast-2`**; and its verified state is `ACTIVE_HEALTHY`. The project was empty before the reviewed migrations were applied.

The foundation target has received `0001_tavonel_tenant_foundation`, `0002_credit_ledger_and_gpu_reservations`, `0003_harden_rls_function_exposure`, and `0004_harden_credit_ledger_rls`. It contains 13 public metadata/permission tables, all RLS-enabled and observed empty after migration. A rollback-only synthetic A/B tenant probe returned `rls_matrix_passed: true` with zero persisted fixture rows. The final Security Advisor scan returned `lints: []`; the detailed nonsecret evidence is in `docs/SUPABASE_QUALIFICATION.md`.

An earlier browser-only draft is permanently discarded because a provider-generated database credential surfaced in its transcript before the draft was canceled. That credential must never be retrieved, repeated, reused, transmitted, committed, or configured. The later dedicated project was created without reproducing that value.

## Next safe action

Email and Google OAuth are still unconfigured. Before either provider is enabled, obtain contextual approval of the exact foundation HTTPS origin, redirect URI, newly dedicated Google OAuth client/consent configuration, and secure client-secret handling. Public Supabase configuration may be configured only after that approval; server-only credentials must remain in managed secret storage and outside browser code and source control.

## Paddle sandbox preflight

The current browser session reaches the Paddle sandbox login screen but has no authenticated vendor session. No Paddle vendor account, catalog, checkout link, notification destination, signing secret, or live billing configuration was created or modified. The foundation therefore continues to return `BILLING_NOT_CONFIGURED` for every checkout intent.

## Cloudflare R2 preflight

The browser dashboard session was unauthenticated. Separately, an account-authorized Cloudflare binding was used to create the dedicated empty foundation bucket described below. No Worker, API token, access key, secret, CORS rule, public endpoint, or browser upload signer has been created. The existing production quarantine resources were not visited or changed. Browser-direct customer intake remains globally disabled in the foundation policy.

## Dedicated R2 quarantine bucket

On 2026-08-27, the account-authorized Cloudflare binding created the separate empty bucket `tavonel-saas-foundation-quarantine`. Its provider metadata reports Standard storage, `APAC` location, and default jurisdiction. This is an APAC best-effort placement, not a Korea-residency guarantee. No Worker binding, public endpoint, API token, access key, secret, CORS rule, object, or signing capability was created. The bucket is not connected to this application and cannot accept browser uploads while the global intake policy remains disabled.

Cloudflare’s documented browser-direct R2 mechanism is a server-side presigned `PUT` URL. It keeps R2 credentials out of the browser but requires a dedicated signing identity on the server or Worker.[1] No such identity or credential has been created for this foundation, so an R2 URL must not be issued. The future signer must bind a request to a validated workspace/document key, expected MIME type and content length, and a short expiry; it must not allow arbitrary keys or byte streaming through the application.

On 2026-08-27, the exact Foundation bucket completed one authorized, harmless 69-byte ASCII marker `PUT` → same-key `GET` → immediate `DELETE` transaction. All three responses were HTTP 200 and the object was removed. This only proves the dedicated bucket control plane; it does not qualify a customer upload path, CORS, a signer, MIME/size enforcement, tenant authorization, CDR, or customer-data handling. The nonsecret record is `docs/SYNTHETIC_R2_QUALIFICATION_2026-08-27.md`.

## Foundation CDR and GPU qualification status

The isolated Google Cloud project `tavonel-saas-foundation` now has its own attachment to the existing active billing account, after Google approved one additional paid-services-project quota and the user explicitly approved this Foundation-only association. With further explicit approvals, Cloud Run Admin API (`run.googleapis.com`), Secret Manager API, and Cloud Build API were enabled only in this Foundation project.

The reviewed one-shot HMAC bootstrap then succeeded in a Foundation-only Cloud Build. Its nonsecret log marker confirmed creation, and Secret Manager lists `tavonel-cdr-hmac` with one version, user-managed location `asia-northeast3`, and the intended `system=tavonel`, `component=cdr`, `scope=synthetic` labels. The secret payload was never opened or printed. The same build created no artifacts.

With the user's separate deployment approval, one Foundation Cloud Run service named `tavonel-cdr-synthetic` was source-deployed in `asia-northeast3`; it is the only Foundation Cloud Run service and receives 100% of service traffic. It uses the Foundation-only source-deploy artifact path and no production project source, service, or secret. The requested `gcloud logging exclusions` command did not reach Google Cloud because this Cloud Shell installation has no `logging exclusions` command group; its parse error created no exclusion. A subsequent direct Logging REST attempt was rejected with HTTP 400 for filter syntax before creation. The supported `_Default` sink update then reported `CONFIG_DUPLICATE_EXCLUSION_NAME`; read-only `gcloud logging sinks describe _Default --format=json` confirmed why: an enabled exclusion named `tavonel-cdr-synthetic-request-logs` already exists with the exact service-scoped filter `resource.type="cloud_run_revision" AND resource.labels.service_name="tavonel-cdr-synthetic" AND logName="projects/tavonel-saas-foundation/logs/run.googleapis.com%2Frequests"`. The record has no `disabled` field, which means it is enabled. No more exclusion create/update calls are permitted.

The public non-content `/health` endpoint returned HTTP 200 with `status: ok`, `mode: pdf-raster`, and the expected service identity. Three zero-byte synthetic multipart probes then returned HTTP 401 with `cache-control: no-store`: missing authentication headers, invalid signature, and expired timestamp. Each probe supplied no usable document content and is rejected by the request authentication path before filename/body validation, renderer invocation, or output creation. A validly signed harmless synthetic sanitize request has not yet been sent; it requires a provider-internal test runner that reads the HMAC only inside Secret Manager/Cloud Build and records headers/digests rather than the secret or document body. No customer byte or GPU resource has been sent or created. The existing production CDR service is neither used nor changed.

RunPod remains disconnected for this task. A provider-independent source contract now prevents even a future endpoint-create call unless immutable release evidence and fresh read-only capacity evidence are present, the request is synthetic-only, `QUALIFICATION_ONLY` behavior disables SSH, HTTP health is on port `8001`, minimum workers and persistent volume are both zero, container disk is at least 80 GiB, cumulative committed plus estimated spend is at most $5 USD, and no previous paid-write result exists. The contract does not invoke RunPod, issue a credential, or override the global disabled GPU-dispatch gate. Its four regression cases are in `server/foundation/runpodSyntheticQualification.test.ts`.

## Cloudmersive inquiry — relevance only

Cloudmersive replied to a prior Advanced CDR sales inquiry. The vendor states that requests are stateless/in-memory, customer payloads are not stored or used for training, and employees do not access customer data; it offered a DPA and Managed Instance options for review. This is relevant as a **possible future third-party CDR alternative**, but it is not part of the Foundation's active architecture and is not a qualification result. The reply did not establish the requested APAC processing/failover/logging/backup locations, retention/deletion terms, authentication controls, supported-format limits, pricing/POC/cancellation terms, or an executed DPA. No account, API key, contract, managed instance, customer-data request, or reply was created or sent.

## References

[1]: https://developers.cloudflare.com/r2/objects/upload-objects/ "Cloudflare R2 — Upload Objects and presigned URLs"

## Signed synthetic CDR qualification — result

Foundation Cloud Build `acb51e28-236a-4e67-8f81-51eb4605f597` completed successfully after the default Cloud Build compute identity received only `roles/secretmanager.secretAccessor` on `tavonel-cdr-hmac`. The one provider-internal step sent the deterministic 806-byte harmless PDF fixture to the Foundation endpoint and removed temporary fixture, response, and header files on exit. Nonsecret output recorded HTTP 200, `input_bytes=806`, `output_bytes=10717`, `content-type: application/pdf`, `x-tavonel-cdr-status: clean`, matching input digest headers, and an output SHA-256 digest. The HMAC payload was not printed. The Cloud Build command log includes the deterministic fixture base64 as command text; it contains no customer or personal data and is not a customer fixture. No second valid request, customer byte, GPU dispatch, R2 customer object, payment, or promotion action occurred.


## RunPod MCP authentication note

RunPod's official MCP documentation says the hosted `https://mcp.getrunpod.io/` server uses Sign in with Runpod (OAuth), while a RunPod API key may be used for a local server or as a hosted-server override via a bearer header. The Foundation connector is configured for hosted URL mode with instant OAuth; its authorization attempt was rejected with `redirect_uri is not allowed`, and the connector remains disabled. The safe alternative, if later separately approved, is a managed-secret API-key connector or a local MCP process, not an invented callback or a repeated OAuth attempt. No endpoint or GPU resource has been created. Source: https://docs.runpod.io/get-started/mcp-servers

## RunPod API-key MCP and APAC capacity preflight — 2026-08-28 (KST)

The previously reported RunPod MCP `server not found` condition was resolved by using the enabled server key `runpod-foundation-read-only`, which maps to the Foundation-specific hosted MCP URL `https://mcp.getrunpod.io/`. The connector is enabled and its credential remains server-side; no secret value was printed, copied into source, or written to this record. The first successful call was the read-only `list-gpu-types` operation with `product=SERVERLESS`, `includeUnavailable=false`, `minMemoryGb=16`, and `limit=100`.

The catalog returned deployable entries, including high-availability examples such as A40 (48 GB, listed Serverless rate $1.22/hour), RTX 4090 (24 GB, $1.10/hour), RTX 5090 (32 GB, $1.58/hour), H200 (141 GB, $5.93/hour), and RTX A5000 (24 GB, $0.69/hour). These are catalog observations only; they are not a quote for a specific workload, do not prove Seoul availability, and did not create or mutate any RunPod resource.

A second read-only `get-capacity` deep probe was issued for Secure Cloud, one GPU, CUDA 12.9, and the candidate GPU IDs NVIDIA GeForce RTX 4090, NVIDIA A100 80GB PCIe, and NVIDIA H200. The structured result returned zero items and no error. Therefore the required CUDA 12.9 capacity was not evidenced for those candidates, and the synthetic GPU qualification build was not attempted. This is a fail-closed result, not a capacity failure diagnosis for every CUDA version or every GPU type.

The read-only `list-data-centers` query for region `Asia` returned only `AP-IN-1` and `AP-JP-1`; no Seoul data center was returned. Consequently, the current preflight does not establish Seoul/APAC-local GPU placement. No endpoint, pod, template, network volume, job, worker, paid request, retry, or GPU spend occurred. The global OCR/GPU dispatch gate remains disabled, and the Foundation still requires an immutable approved worker release artifact, compatible runtime evidence, and a fresh capacity result before any one-shot paid mutation can even be considered.

Evidence files are retained locally at `/home/ubuntu/.mcp/tool-results/2026-08-28_02-49-20.275889176_runpod-foundation-read-only_list-gpu-types_c45081e1.json`, `/home/ubuntu/.mcp/tool-results/2026-08-28_02-50-03.923430656_runpod-foundation-read-only_get-capacity_14d5c69b.json`, and `/home/ubuntu/.mcp/tool-results/2026-08-28_02-50-46.162606833_runpod-foundation-read-only_list-data-centers_72a4bf6e.json`. The provider's MCP overview and authentication model are documented at [2].

[2]: https://docs.runpod.io/get-started/mcp-servers "RunPod MCP servers"
