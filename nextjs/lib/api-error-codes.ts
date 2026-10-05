/*
  One catalogue of machine codes, for the documentation page and the OpenAPI contract alike.

  G3-019 found the failure this file exists to end: `/docs/errors` catalogued twelve codes, the
  API returns at least twenty-one, and `AUTH_REQUIRED` -- the first error every developer sees,
  because it is what a missing or wrong key returns -- was in neither the page nor the spec. Two
  hand-maintained lists drifted from a third place that was the only one anybody ran.

  So the codes live here once. `/docs/errors` renders this array, `app/api/openapi/route.ts`
  builds the `Error` schema's enum and every per-operation error description from it, and
  `app/api/page.tsx` prints it under each operation. A code added to a route and not added here
  fails `lib/api-error-codes.test.ts`, which scans the handler files that serve the documented
  surface and refuses an unknown one.

  Three rules.

  **`status` is optional and is filled only where it was read off the handler.** The same code is
  returned with different statuses by different routes -- `NOT_FOUND` is a 404 on one route and a
  422 on another -- and a status typed here from the shape of the name would be an invented fact.
  The authoritative status per operation is in the OpenAPI document, where each error sits under
  the status key that operation actually answers with. The catalogue carries what the code means
  and what to do about it, which is what a status cannot tell you.

  **`whatToDo` is required.** G3-020: a catalogue with Code / Status / Meaning and no remediation
  column leaves the reader exactly where they started. If there is nothing a caller can do, the
  entry says that in those words rather than being left blank.

  **Nothing here is a success.** Codes that ride in the same `code` field on a 2xx -- `OK`,
  `GROUNDED_ANSWER`, `COMPILE_JOB_ACCEPTED` -- are results, not errors, and they are listed
  separately in `API_RESULT_CODES` so the scan can tell them apart without either list guessing.
*/

export type ApiErrorCode = {
  readonly code: string;
  /** The HTTP status this code was read returning, where one route owns it. Omitted where it varies. */
  readonly status?: number;
  readonly meaning: string;
  /** What a caller does next. Never empty: "nothing" is an answer and it is written out. */
  readonly whatToDo: string;
};

/** Named groups, so the catalogue reads as a table a person can scan rather than an alphabet. */
export type ApiErrorGroup = {
  readonly title: string;
  readonly summary: string;
  readonly codes: readonly ApiErrorCode[];
};

export const API_ERROR_GROUPS: readonly ApiErrorGroup[] = [
  {
    title: "Authentication, scope and plan",
    summary: "Everything that can refuse a request before it reaches the work.",
    codes: [
      { code: "CONNECTION_ID_INVALID", status: 400, meaning: "The connection id was not a UUID.", whatToDo: "Use the id from `GET /connections`." },
      { code: "OAUTH_CONNECTION_ID_INVALID", status: 400, meaning: "The OAuth connection id was not a UUID.", whatToDo: "Use the id from `GET /oauth-connectors`." },
      { code: "API_KEY_ID_INVALID", status: 400, meaning: "The key id was not a UUID.", whatToDo: "Use the key id shown in Workspace → Developers." },
      { code: "API_KEY_INPUT_INVALID", status: 400, meaning: "The rotation body did not validate.", whatToDo: "Check the request schema for the operation." },
      { code: "MANIFEST_DIGEST_INVALID", status: 400, meaning: "The manifest digest did not match `sha256:<64 hex>`.", whatToDo: "Pass the digest exactly as the World reported it, prefix included." },
      { code: "SOURCE_IDEMPOTENCY_KEY_INVALID", status: 400, meaning: "`x-tavonel-source-idempotency-key` was present and was not 64 hex characters.", whatToDo: "Send a sha256 hex digest, or omit the header entirely." },
      { code: "QUESTION_INVALID", status: 400, meaning: "The question was absent, or shorter than the minimum.", whatToDo: "Send a question between 3 and 500 characters." },
      { code: "QUESTION_TOO_LARGE", status: 413, meaning: "The question exceeded 500 characters.", whatToDo: "Shorten it. Ask is a question, not a document." },
      { code: "QUERY_INVALID", status: 400, meaning: "The search query was absent, or shorter than the minimum.", whatToDo: "Send a query between 3 and 500 characters." },
      { code: "QUERY_TOO_LARGE", status: 413, meaning: "The search query exceeded 500 characters.", whatToDo: "Shorten it." },
      { code: "RETRIEVAL_QUESTION_INVALID", status: 400, meaning: "The retrieval runtime refused the question text itself.", whatToDo: "Send a plain question; control characters and empty strings are refused." },
      { code: "WORLD_PAGE_LIMIT_INVALID", status: 400, meaning: "`limit` was outside 1–50.", whatToDo: "Use a limit inside 1–50, or omit it to read the whole lens." },
      { code: "WORLD_PAGE_CURSOR_INVALID", status: 400, meaning: "The cursor named an id this lens does not contain. A wrong cursor is refused rather than answered with an empty page, so a paging bug is visible instead of silent.", whatToDo: "Restart from the first page. The cursor is the last item id from the previous page, keyset — not an offset." },
      { code: "WORLD_LENS_NOT_PAGEABLE", status: 400, meaning: "`history`, `files` and `review` return whole; `limit` and `cursor` are refused on them.", whatToDo: "Drop the paging parameters for those three lenses." },
      { code: "WORLD_PROMOTION_INVALID", status: 400, meaning: "The activation request body did not validate.", whatToDo: "Activation is a signed-in browser action; no API key holds it." },
      { code: "WORLD_ROLLBACK_INVALID", status: 400, meaning: "The rollback request body did not validate.", whatToDo: "Rollback is a signed-in browser action; no API key holds it." },
      { code: "PROMOTION_METADATA_TOO_LARGE", status: 413, meaning: "The activation note exceeded its bound.", whatToDo: "Shorten the note." },
      { code: "ROLLBACK_METADATA_TOO_LARGE", status: 413, meaning: "The rollback note exceeded its bound.", whatToDo: "Shorten the note." },
      { code: "CONNECTION_INPUT_INVALID", status: 400, meaning: "The connection body did not match `ConnectionInput`.", whatToDo: "Check the schema: `provider`, `mode`, `displayName` and `configuration` are required and `secretReference` must be null." },
      { code: "CONNECTION_BATCH_INVALID", status: 400, meaning: "The sync batch did not match `ConnectionBatch`.", whatToDo: "Check the schema. Every event needs `kind`, `nativeId`, `revision`, `contentSha256`, `sizeBytes`, `mimeType`, `documentId` and `sourceIdempotencyKey`, each nullable where the schema says so." },
      { code: "OAUTH_CONNECTOR_INPUT_INVALID", status: 400, meaning: "The authorization body did not match `OAuthConnectorAuthorizationInput`.", whatToDo: "Send a supported `provider` and a `displayName`." },
      { code: "OAUTH_SYNC_INPUT_INVALID", status: 400, meaning: "The OAuth connection sync body did not validate.", whatToDo: "Check the schema for the operation." },
      { code: "AUDIT_EXPORT_WINDOW_INVALID", status: 400, meaning: "The audit export window was not a range TAVONEL serves.", whatToDo: "Narrow the window." },
    ],
  },
  {
    title: "Documents and intake",
    summary: "What stops a file before it becomes a source — including the two ceilings the deployment actually enforces.",
    codes: [
      { code: "COMPLETED_READ_INVALID_OR_DISABLED", status: 503, meaning: "The internal settlement carried completed-read facts while certification was disabled, or the facts conflicted with the settlement scope or outcome.", whatToDo: "Preserve the stored OCR and retry the same settlement after the configuration or fact mismatch is resolved." },
      { code: "COMPLETED_READ_REQUIRED", status: 503, meaning: "Completed-read certification was enabled, but a successful OCR settlement omitted its required persisted-read facts.", whatToDo: "Recover the facts from the existing persisted OCR and retry the same settlement without another OCR call." },
      { code: "COMPLETED_READ_DISABLED", status: 503, meaning: "The completed-read settlement helper refused certification because its rollout flag was disabled.", whatToDo: "Preserve the pending settlement and resolve the worker/server configuration mismatch before retrying." },
      { code: "COMPLETED_READ_INVALID", status: 503, meaning: "The completed-read settlement helper could not validate the exact receipt shape, object keys, identities, digests or observed page count.", whatToDo: "Recover the original persisted-read facts and correct the mismatch before retrying the same settlement." },
      { code: "COMPLETED_READ_DIRECT_UPLOAD_REQUIRED", status: 503, meaning: "The current source scope could not be established as a confirmed direct upload; connector sources cannot receive completed-read certification.", whatToDo: "Check durable upload admission and source scope. Do not certify connector or unexplained source origins." },
      { code: "COMPLETED_READ_SETTLEMENT_FAILED", status: 503, meaning: "The completed-read transaction failed or its response did not acknowledge the exact successful reservation settlement and immutable proof.", whatToDo: "Retry the identical persisted-read facts to reconcile an uncertain commit. Do not fall back to legacy settlement." },
      { code: "INTAKE_TRIAGE_REQUIRED", meaning: "The request has no completed server-owned triage receipt for the selected intake set.", whatToDo: "Run source triage, review the whole set and continue with its returned receipt." },
      { code: "TRIAGE_COMPLETE_BODY_INVALID", meaning: "The request to complete triage did not identify a valid staged member and preflight approval.", whatToDo: "Use the stage and preflight identifiers returned for this batch." },
      { code: "INTAKE_TRIAGE_STAGE_RECEIPT_INVALID", meaning: "The server could not prove the staged member belongs to the expected triage receipt.", whatToDo: "Recover the same batch from the server before retrying completion." },
      { code: "INTAKE_TRIAGE_SEAL_RETRY_REQUIRED", status: 409, meaning: "The staged object could not be proven sealed into its immutable quarantine version.", whatToDo: "Reconcile the same triage member and retry only after its seal state is known." },
      { code: "TRIAGE_PREFLIGHT_BODY_INVALID", meaning: "The preflight request did not contain a valid batch identity and complete set of choices.", whatToDo: "Review the full batch and submit its supported choices again." },
      { code: "TRIAGE_RECEIPT_BODY_INVALID", meaning: "The receipt request did not identify a valid batch, preflight approval and set of choices.", whatToDo: "Use the identifiers returned by triage and submit the complete reviewed set." },
      { code: "INTAKE_TRIAGE_BATCH_INCOMPLETE", status: 409, meaning: "The server has not received every expected member of this triage batch.", whatToDo: "Finish staging the complete batch before requesting its receipt." },
      { code: "INTAKE_TRIAGE_PREFLIGHT_INCOMPLETE", status: 409, meaning: "The server has no complete preflight approval for the triage batch.", whatToDo: "Run preflight on the entire batch and review its returned maximum." },
      { code: "TRIAGE_NO_FILES_SELECTED", status: 409, meaning: "The reviewed triage receipt contains no files approved for intake.", whatToDo: "Select at least one eligible file, or stop this intake attempt." },
      { code: "TRIAGE_STAGE_BODY_INVALID", meaning: "The request to stage triage files did not contain a valid batch and file list.", whatToDo: "Use a valid batch identity and submit supported files within the stated limits." },
      { code: "TRIAGE_STAGE_FILE_INVALID", meaning: "A file in the triage staging request failed its identity, type or size checks.", whatToDo: "Review that file's reported error and select a supported file before retrying." },
      { code: "TRIAGE_STAGE_PARTIAL", meaning: "At least one requested file failed staging; the response may also identify files that were staged successfully.", whatToDo: "Inspect every per-file result and reselect any member that did not stage." },
      { code: "TRIAGE_CHOICES_REQUIRED", status: 409, meaning: "The triage receipt did not include one supported include or exclude choice for every reviewed file.", whatToDo: "Review every listed item and submit an include or exclude choice for the complete set." },
      { code: "INTAKE_TRIAGE_ROLLOUT_DISABLED", status: 503, meaning: "The coordinated file triage workflow is not enabled.", whatToDo: "Retry only after the triage client, server and versioned storage contract are deployed together." },
      { code: "INTAKE_RETRIAGE_REQUIRED", status: 409, meaning: "The saved triage receipt is missing, stale or inconsistent with the approved member and current configuration.", whatToDo: "Review and approve a fresh complete-set triage receipt before continuing." },
      { code: "INTAKE_TRIAGE_OBJECT_NOT_SEALED", status: 409, meaning: "The server cannot prove the triage upload was sealed into the required immutable quarantine object.", whatToDo: "Reconcile the same member and retry only after the server confirms its sealed state." },
      { code: "INTAKE_TRIAGE_OBJECT_CHANGED", status: 409, meaning: "The quarantine object no longer matches the approved triage member's size, type or immutable version.", whatToDo: "Do not confirm this object; reconcile the approved member or review a fresh intake." },
      { code: "INTAKE_APPROVAL_INVALID", status: 400, meaning: "The approval manifest or attempt identity was malformed or exceeded the supported complete-set bounds.", whatToDo: "Reselect the complete file set and review the new maximum before approving it." },
      { code: "INTAKE_APPROVAL_DUPLICATE_FILE", status: 400, meaning: "The manifest repeated a stable file identity, so the server refused to create an ambiguous approval.", whatToDo: "Reselect the complete set; do not submit duplicate entries." },
      { code: "INTAKE_APPROVAL_MIME_NOT_NORMALIZED", status: 400, meaning: "The approved MIME value does not exactly match the server-normalized file type.", whatToDo: "Use the MIME type and filename pair shown by the supported formats list." },
      { code: "INTAKE_APPROVAL_MANIFEST_MISMATCH", status: 400, meaning: "The manifest digest does not match the complete file metadata the browser submitted.", whatToDo: "Reselect and hash the whole set again, then approve its current maximum." },
      { code: "INTAKE_APPROVAL_UNKNOWN_CEILING_REQUIRED", status: 503, meaning: "The server could not preserve the full per-file processing ceiling for an uncounted format.", whatToDo: "Retry after the intake configuration is corrected; no lower maximum was approved." },
      { code: "INTAKE_APPROVAL_AGGREGATE_EXCEEDED", status: 409, meaning: "The approved aggregate maximum exceeds a server-enforced bound.", whatToDo: "Review a fresh whole-set quote and approve only its exact maximum." },
      { code: "INTAKE_APPROVAL_AGGREGATE_MISMATCH", status: 409, meaning: "The server's recomputed maximum differs from the amount the customer approved.", whatToDo: "Review the returned maximum and explicitly approve the refreshed quote." },
      { code: "INTAKE_APPROVAL_CONFLICT", status: 409, meaning: "The same attempt key was reused for a different file set, quote or pricing fingerprint.", whatToDo: "Reselect the exact original files to recover, or review and approve the changed complete set under a new attempt." },
      { code: "INTAKE_APPROVAL_FILE_OUT_OF_SCOPE", status: 409, meaning: "A requested file is not a member of this server-held approval.", whatToDo: "Reselect the exact approved set and retry with its saved attempt identity." },
      { code: "INTAKE_APPROVAL_REQUIRED", status: 428, meaning: "The upload operation has no valid customer-approved attempt identity.", whatToDo: "Review and approve the complete set's maximum before requesting upload capabilities." },
      { code: "INTAKE_APPROVAL_SCOPE_MISMATCH", status: 409, meaning: "The document, content digest, file identity or scope differs from the approved manifest.", whatToDo: "Reselect the exact approved file and recover that attempt; changed content requires a new approval." },
      { code: "INTAKE_APPROVAL_RESERVATION_EXPIRED", status: 409, meaning: "The approved member's processing reservation expired before the capability operation completed.", whatToDo: "Recover the attempt and request a newly reviewed quote and approval." },
      { code: "INTAKE_APPROVAL_CANCEL_INVALID", status: 400, meaning: "The cancellation request did not identify one valid approved member.", whatToDo: "Recover the saved attempt and submit its exact member identity." },
      { code: "COMPUTE_LEDGER_NOT_CONFIGURED", status: 503, meaning: "The approved-intake ledger is not configured, so this request could not read or write durable approval state.", whatToDo: "Retry after ledger configuration is restored, recovering the same attempt before creating another." },
      { code: "INTAKE_APPROVAL_LEDGER_FAILED", status: 503, meaning: "The approved-intake ledger could not complete a durable operation; its commit status may be uncertain.", whatToDo: "Read the same attempt to recover its committed state before retrying." },
      { code: "INTAKE_APPROVAL_RECEIPT_INVALID", status: 503, meaning: "The ledger response did not prove the expected approved member identity or state.", whatToDo: "Recover the same attempt from the server before retrying or compiling." },
      { code: "INTAKE_PRICE_STALE", status: 409, meaning: "Pricing changed after the customer reviewed the quote, so the former maximum cannot authorize this intake.", whatToDo: "Review the refreshed maximum and approve again." },
      { code: "INTAKE_CONFIRMATION_FAILED", status: 503, meaning: "The atomic admission and approval confirmation could not be completed.", whatToDo: "Recover the same attempt to determine whether confirmation committed before retrying." },
      { code: "INTAKE_CONFIRMATION_NOT_CONFIGURED", status: 503, meaning: "The confirmation database connection is not configured.", whatToDo: "Retry after the service configuration is restored; do not create a replacement attempt while this one is uncertain." },
      { code: "INTAKE_CONFIRMATION_RECEIPT_INVALID", status: 503, meaning: "The database response did not prove that this approved member was atomically confirmed.", whatToDo: "Recover the same attempt from the server before retrying or compiling." },
      { code: "QUARANTINE_ADMISSION_NOT_FOUND", status: 409, meaning: "No matching intake admission exists for the approved document.", whatToDo: "Recover the attempt or restart by reviewing a fresh complete-set maximum." },
      { code: "QUARANTINE_OBJECT_NOT_FOUND", status: 409, meaning: "The uploaded object is absent, so confirmation or release cannot proceed as requested.", whatToDo: "Retry the same approved member and recover its state before starting another attempt." },
      { code: "INVALID_SOURCE_DIGEST", status: 400, meaning: "The submitted content digest is not a valid SHA-256 identity.", whatToDo: "Hash the exact selected bytes again and retry the same approved attempt." },
      { code: "OBSERVED_MIME_MISMATCH", status: 409, meaning: "The stored object's observed MIME type differs from the approved type.", whatToDo: "Choose a file whose content and filename match a supported format, then approve the new complete set." },
      { code: "UPLOAD_CONFIRM_BODY_INVALID", status: 400, meaning: "The confirmation request did not identify a valid approved document.", whatToDo: "Recover the saved attempt and submit the exact approved member identity." },
      { code: "UPLOAD_CONFIRM_REQUEST_TOO_LARGE", status: 413, meaning: "The confirmation metadata exceeded the endpoint's bounded request size.", whatToDo: "Retry with the supported attempt and member fields only." },
      { code: "UPLOAD_RELEASE_BODY_INVALID", status: 400, meaning: "The release request did not identify a valid approved document.", whatToDo: "Recover the saved attempt and submit the exact approved member identity." },
      { code: "UPLOAD_RELEASE_REQUEST_TOO_LARGE", status: 413, meaning: "The release metadata exceeded the endpoint's bounded request size.", whatToDo: "Retry with the supported attempt and member fields only." },
      { code: "UPLOAD_ALREADY_STORED", status: 409, meaning: "The release endpoint found the object in storage, so the approved member was not released.", whatToDo: "Confirm the same approved member; do not start a replacement attempt." },
      {
        code: "AUTH_REQUIRED",
        status: 401,
        meaning: "No credential was presented, or the bearer token is not a key TAVONEL issued. This is what an unauthenticated request to any scoped route returns.",
        whatToDo: "Send `Authorization: Bearer <key>`. Keys are created in Workspace → Developers and the plaintext is shown once; a key you cannot find again is rotated, not recovered.",
      },
      {
        code: "API_KEY_INVALID",
        meaning: "The bearer token was well-formed but did not match a stored key.",
        whatToDo: "Check you are sending the whole key, including the `tvnl_live_` prefix, and that it belongs to TAVONEL.",
      },
      {
        code: "API_KEY_EXPIRED",
        meaning: "The key matched and its expiry has passed.",
        whatToDo: "Rotate it: `POST /developer/keys/{id}/rotate` in a signed-in session returns a replacement once.",
      },
      {
        code: "API_KEY_REVOKED",
        meaning: "The key matched and was revoked. A rotation revokes the key it replaces.",
        whatToDo: "Use the replacement key from the rotation, or mint a new one.",
      },
      {
        code: "API_SCOPE_REQUIRED",
        status: 403,
        meaning: "The key authenticated and does not carry the scope this operation requires. The request was refused rather than answered with less.",
        whatToDo: "Mint a key carrying the scope named in the operation's `x-tavonel-scope`. Scopes are fixed at creation; a key is not widened in place.",
      },
      {
        code: "PILOT_ACCESS_REQUIRED",
        status: 403,
        meaning: "The credential is valid and the workspace it names is not admitted to TAVONEL.",
        whatToDo: "Nothing a caller can send fixes this. Access is arranged with us — write to support@tavonel.com.",
      },
      {
        code: "WORKSPACE_MEMBERSHIP_REQUIRED",
        status: 403,
        meaning: "The user is authenticated but has no active durable membership in the requested workspace.",
        whatToDo: "Accept a valid workspace invitation, or ask a workspace owner to restore membership before retrying.",
      },
      {
        code: "API_KEY_AUTHORIZATION_REVOKED",
        status: 403,
        meaning: "The API key was issued under an older membership authority revision and cannot regain access after that grant changes.",
        whatToDo: "Create a new key after the current membership is confirmed; an old key cannot be revived.",
      },
      {
        code: "AUTHORIZATION_CHANGED_RETRY",
        status: 403,
        meaning: "The caller's authorization changed while the request was in flight, so the request was abandoned rather than finished under a permission that may no longer hold.",
        whatToDo: "Retry once. A second occurrence means the permission really was removed.",
      },
      {
        code: "SUBSCRIPTION_REQUIRED",
        meaning: "The workspace has no plan that includes this operation.",
        whatToDo: "See /pricing for which plan includes it.",
      },
      {
        code: "STUDIO_SUBSCRIPTION_REQUIRED",
        status: 402,
        meaning: "The operation needs the higher plan tier — activation, rollback and retrieval-index rebuild are the three.",
        whatToDo: "See /pricing. The bar is the same for all three on purpose: a plan that may activate and may not rebuild would leave its own Worlds answering from the fallback.",
      },
      {
        code: "SELF_SERVICE_NOT_ENABLED",
        meaning: "Self-serve purchase is not open today.",
        whatToDo: "Nothing a caller can send changes it. Access is arranged with us.",
      },
      {
        code: "GPU_CREDITS_REQUIRED",
        meaning: "The workspace has no processing balance left to reserve against.",
        whatToDo: "Add pages, or wait for the next grant. Nothing was charged.",
      },
    ],
  },
  {
    title: "Rate and concurrency",
    summary: "The two limits the deployment enforces, and the one case where a refusal means the limit could not be read.",
    codes: [
      {
        code: "API_RATE_LIMITED",
        status: 429,
        meaning: "The key has used its per-minute allowance for this scope. The window is a fixed clock minute per key and scope; the allowances are on /docs/billing-and-limits.",
        whatToDo: "Wait for the next clock minute and retry. No `Retry-After` header is sent today, so back off on your own clock — a fixed one-minute wait is enough by construction.",
      },
      {
        code: "API_RATE_LIMIT_UNAVAILABLE",
        status: 503,
        meaning: "The allowance could not be read, so the request was refused rather than run unbounded.",
        whatToDo: "Retry. This is fail-closed behaviour, not a limit you hit.",
      },
      {
        code: "ACTIVATION_RATE_LIMITED",
        status: 429,
        meaning: "The workspace has used its hour's allowance of World activations, rollbacks or retrieval-index rebuilds. Nothing was charged.",
        whatToDo: "Honour the `Retry-After` header — it carries the seconds until the oldest one leaves the window — rather than retrying immediately.",
      },
      {
        code: "ACTIVATION_RATE_LIMIT_UNAVAILABLE",
        status: 503,
        meaning: "That hourly allowance could not be read, so the request was refused rather than run unbounded.",
        whatToDo: "Retry. This is fail-closed behaviour, not a limit you hit.",
      },
      {
        code: "INTAKE_RATE_LIMITED",
        status: 429,
        meaning: "Too many upload capabilities were requested in the window.",
        whatToDo: "Honour `Retry-After` (60 seconds) and retry.",
      },
      {
        code: "INTAKE_DAILY_QUOTA_EXCEEDED",
        status: 429,
        meaning: "The workspace's daily intake quota is spent.",
        whatToDo: "Honour `Retry-After` (3600 seconds); the quota rolls with the day.",
      },
      {
        code: "WORKSPACE_CONCURRENCY_LIMIT",
        status: 429,
        meaning: "The workspace already has as many compiles in flight as it may.",
        whatToDo: "Wait for one to settle. Poll `GET /compile-jobs` to see which.",
      },
      {
        code: "COMPILE_JOB_WORKSPACE_LIMIT_REACHED",
        meaning: "The workspace is at its compile-job ceiling.",
        whatToDo: "Let running jobs settle before starting another.",
      },
      {
        code: "WORKSPACE_CACHE_CAPACITY_LIMIT",
        meaning: "The workspace's cached working set is full.",
        whatToDo: "Retry after current work settles.",
      },
    ],
  },
  {
    title: "Request shape",
    summary: "Refusals decided from the request alone, before any state is read.",
    codes: [
      { code: "INVALID_JSON", status: 400, meaning: "The body was not parseable JSON.", whatToDo: "Send valid JSON and `content-type: application/json`." },
      { code: "NOT_JSON", status: 400, meaning: "The request did not declare a JSON body.", whatToDo: "Set `content-type: application/json`." },
      { code: "METADATA_ONLY_ENDPOINT", status: 415, meaning: "Document bytes were POSTed to a route that accepts only metadata. Bytes go direct to storage, never through the application server.", whatToDo: "Request an upload capability and PUT the bytes to the URL it returns." },
      { code: "REQUEST_TOO_LARGE", status: 413, meaning: "The JSON body exceeded the route's bound.", whatToDo: "Split the request. The bounds are per-route and stated in the operation." },
      { code: "JSON_TOO_LARGE", status: 413, meaning: "The JSON body exceeded the shared parse bound.", whatToDo: "Split the request." },
      { code: "UNQUALIFIED_INPUT", status: 400, meaning: "A required field was missing or was not of the declared type.", whatToDo: "Check the request schema for the operation; the response names no field, so validate against the contract." },
      { code: "LIMIT_INVALID", status: 400, meaning: "`limit` was outside the range the operation accepts.", whatToDo: "Use a limit inside the bounds the operation declares." },
      { code: "AUDIT_LIMIT_INVALID", status: 400, meaning: "The audit `limit` was outside its range.", whatToDo: "Use a limit inside the declared bounds." },
      { code: "RUN_ID_REQUIRED", status: 400, meaning: "The run id path segment was empty.", whatToDo: "Supply the run id returned when the run was started." },
      { code: "RESOLUTION_REQUIRED", status: 400, meaning: "A blocker resolution was requested with no `resolution` field.", whatToDo: "Send one of `continue`, `remove_blocked`, `retry_eligible`." },
      { code: "RESOLUTION_NOT_APPLIED", status: 409, meaning: "The resolution was understood and the job's state refused it.", whatToDo: "Re-read the job: the blockers it is holding decide which resolutions are legal." },
      { code: "COLLECTION_ID_INVALID", status: 400, meaning: "The collection id did not match `collection-<32 hex>`.", whatToDo: "Use the id as returned, unmodified." },
      { code: "WORLD_ID_INVALID", status: 400, meaning: "The World id did not match the collection id pattern.", whatToDo: "Use the collection id as returned." },
      { code: "CORPUS_ID_INVALID", status: 400, meaning: "The corpus id did not match `corpus-<32 hex>`.", whatToDo: "Use the corpus id as returned." },
      {
        code: "SOURCE_EXCEEDS_PROCESSING_CEILING",
        status: 413,
        meaning: "`requestedBytes` is above what every processor in the chain can read. The body carries `maxBytes`, `maxPages` and a `limit` sentence. This is the refusal the 5 MB per-source ceiling produces.",
        whatToDo: "Split the document and upload the parts. Admitting a larger file would only move the refusal somewhere you cannot see it.",
      },
      {
        code: "SOURCE_TOO_MANY_PAGES",
        meaning: "The document decoded to more pages than the rasterizer renders. The page ceiling cannot be checked at intake, because intake deliberately never decodes the document, so this arrives after the bytes are stored rather than at the capability call.",
        whatToDo: "Split the document. The page ceiling is published on /docs/files-and-formats and in the capability manifest's `knownLimitations`.",
      },
      { code: "SOURCE_TOO_LARGE", meaning: "A connected source's bytes are above the per-source ceiling.", whatToDo: "Exclude it from the sync, or split it at the source." },
      { code: "INTAKE_FILE_TOO_LARGE", meaning: "The admission ledger refused the size. Answered to the caller as `SOURCE_EXCEEDS_PROCESSING_CEILING`.", whatToDo: "Split the document." },
      { code: "INTAKE_DISABLED", status: 503, meaning: "Intake is closed today.", whatToDo: "Nothing a caller can send opens it. /api/status publishes the current state." },
      { code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", status: 403, meaning: "This workspace has no current approval to process its sources.", whatToDo: "Request source access before uploading or syncing files." },
      { code: "INTAKE_IDEMPOTENCY_CONFLICT", status: 409, meaning: "The same source idempotency key was already used for different bytes.", whatToDo: "Use a fresh key, or re-send the original bytes." },
      { code: "UNQUALIFIED_DOCUMENT", status: 400, meaning: "The document id does not name a document in this workspace, or it is not in a state this operation accepts.", whatToDo: "List documents and use an id from the response." },
      { code: "UNQUALIFIED_MIME", status: 400, meaning: "The declared MIME type is not in the capability manifest.", whatToDo: "Read `GET /capabilities`: a format absent from it is refused at upload rather than accepted and dropped." },
      { code: "MIME_TYPE_UNSUPPORTED", status: 400, meaning: "Same refusal, raised by the qualifier.", whatToDo: "Check `GET /capabilities` before uploading." },
      { code: "FILENAME_MIME_MISMATCH", status: 400, meaning: "The extension and the declared MIME type disagree.", whatToDo: "Declare the MIME type that matches the extension." },
      { code: "FILE_NAME_INVALID", status: 400, meaning: "The filename carried a path separator or a character the store refuses.", whatToDo: "Send a plain filename with no directory component." },
      { code: "INVALID_FILENAME", status: 400, meaning: "Same refusal from the intake validator.", whatToDo: "Send a plain filename." },
      { code: "SIGNER_NOT_CONFIGURED", status: 503, meaning: "The upload URL signer is not configured, so no capability can be issued.", whatToDo: "Nothing a caller can send. /api/status reports the deployment's state." },
      { code: "SOURCE_VERSION_AMBIGUOUS", status: 409, meaning: "Two source versions carry the same identity and the request did not say which.", whatToDo: "Name the version explicitly." },
      { code: "SOURCE_NOT_QUALIFIED", meaning: "A connected source did not qualify for compilation.", whatToDo: "Check the source's format against `GET /capabilities`." },
      { code: "SOURCE_REVOKED", meaning: "The source's connection was revoked; its bytes are no longer reachable.", whatToDo: "Reconnect the source, or drop it from the set." },
      { code: "SOURCE_TOMBSTONED", meaning: "The source was deleted at origin and is recorded as gone rather than silently omitted.", whatToDo: "Remove it from the compile set." },
      { code: "SOURCE_DELETED", status: 409, meaning: "The uploaded source has a deletion tombstone, so its bytes cannot be admitted or served again.", whatToDo: "Choose a different source; a deleted upload cannot be restored through this request." },
      { code: "TRIAL_FILE_TOO_LARGE", status: 413, meaning: "Above the free-evaluation per-file bound, which is lower than the deployment ceiling.", whatToDo: "The body carries `maxBytes`. Split the file, or move to a paid plan." },
      { code: "TRIAL_ARCHIVE_NOT_INCLUDED", status: 402, meaning: "ZIP upload is not included in the free evaluation.", whatToDo: "Upload the files individually, or move to a paid plan." },
      { code: "TRIAL_FILE_LIMIT_EXCEEDED", meaning: "The free evaluation's file count is spent.", whatToDo: "Move to a paid plan." },
      { code: "TRIAL_PAGE_LIMIT_EXCEEDED", meaning: "The free evaluation's page allowance is spent.", whatToDo: "Move to a paid plan." },
      { code: "TRIAL_NOT_ACTIVE", meaning: "No free evaluation is active for this workspace.", whatToDo: "Move to a paid plan." },
      { code: "TRIAL_DISABLED", meaning: "Free evaluation is closed today.", whatToDo: "Nothing a caller can send." },
      { code: "TRIAL_CAPACITY_REACHED", meaning: "The deployment's concurrent free evaluations are full.", whatToDo: "Retry later, or move to a paid plan." },
      { code: "TRIAL_FEATURE_NOT_INCLUDED", status: 402, meaning: "The operation — key rotation among them — is not in the free evaluation.", whatToDo: "Move to a paid plan." },
      { code: "TRIAL_WORLD_LIMIT_REACHED", status: 402, meaning: "The free evaluation's compiled-World count is spent.", whatToDo: "Move to a paid plan." },
      { code: "TRIAL_DURABLE_COMPILE_REQUIRED", status: 402, meaning: "The free evaluation compiles through the durable job route only.", whatToDo: "Use `POST /compile-jobs` rather than `POST /collections/compile`." },
      { code: "TRIAL_SOURCE_REVIEW_REQUIRED", meaning: "A free-evaluation source was held for review by the risk gate.", whatToDo: "Nothing automatic clears it. Write to support@tavonel.com." },
    ],
  },
  {
    title: "Compile",
    summary: "The document set, the job, and what a partial failure does.",
    codes: [
      { code: "DOCUMENT_IDS_REQUIRED", status: 400, meaning: "The request carried no document id array.", whatToDo: "Send `documentIds` with at least one id." },
      { code: "DOCUMENT_SET_EMPTY", status: 400, meaning: "Nothing was selected to compile.", whatToDo: "Send at least one document id." },
      { code: "DOCUMENT_SET_UNQUALIFIED", status: 400, meaning: "A value in `documentIds` was not a document id.", whatToDo: "Send UUIDs as returned by `GET /documents`." },
      { code: "COLLECTION_ARTIFACT_SOURCE_DELETED", status: 409, meaning: "A document in this compile has been deleted, so its result is not stored.", whatToDo: "Compile again without the deleted document." },
      { code: "COLLECTION_ARTIFACT_SOURCE_BLOCKED", status: 409, meaning: "A connector source in this compile is suspended, tombstoned or no longer admitted, so its result is not stored.", whatToDo: "Restore the connector's access, or compile without that source." },
      { code: "COLLECTION_ARTIFACT_PROVENANCE_CONFLICT", status: 409, meaning: "This candidate key is already recorded against a different document set.", whatToDo: "Nothing a caller can send. Report it with the collection id." },
      { code: "COLLECTION_ARTIFACT_PROVENANCE_INVALID", status: 409, meaning: "The candidate's documents could not be recorded, usually because one id is not a UUID.", whatToDo: "Compile documents by the UUIDs returned from `GET /documents`." },
      { code: "COLLECTION_ARTIFACT_PROVENANCE_FAILED", status: 503, meaning: "The candidate's documents could not be recorded, so nothing was stored.", whatToDo: "Retry." },
      { code: "COLLECTION_ARTIFACT_PROVENANCE_NOT_CONFIGURED", status: 503, meaning: "The database is not configured, so no candidate can be recorded or stored.", whatToDo: "Nothing a caller can send." },
      { code: "COLLECTION_ARTIFACT_PUBLICATION_LEASE_EXPIRED", status: 503, meaning: "Too little of the candidate's write window was left to store it safely, so nothing was stored.", whatToDo: "Retry." },
      { code: "DOCUMENT_SET_TOO_LARGE", status: 400, meaning: "More documents than one compile carries were sent to the single-compile route.", whatToDo: "Use `POST /compile-jobs`, which partitions a larger selection into parts server-side." },
      { code: "CORPUS_TOO_LARGE", status: 400, meaning: "More documents than one run carries.", whatToDo: "Split the selection across runs." },
      { code: "SPLIT_PART_LIMIT_EXCEEDED", meaning: "Partitioning the selection would make more parts than a run holds.", whatToDo: "Split the selection across runs." },
      { code: "COMPILE_JOB_NOT_FOUND", status: 404, meaning: "No such job in this workspace. Job ids are workspace-scoped, so this is also the answer for another tenant's id.", whatToDo: "List `GET /compile-jobs` to recover the id." },
      { code: "COMPILE_JOB_SCOPE_INVALID", meaning: "The job exists and belongs to another workspace.", whatToDo: "Use a job from your own workspace." },
      { code: "COMPILE_JOB_ALREADY_SETTLED", status: 409, meaning: "The job had already finished. Nothing was discarded — a cancel arriving a second after a compile finished does not destroy the result.", whatToDo: "Read the job: it is terminal, and its result stands." },
      { code: "COMPILE_JOB_SLOT_CONFLICT", status: 409, meaning: "A part of this corpus is already held by a job over a different document set. Retrying does not clear it.", whatToDo: "Let the holding job settle, or cancel it, before resubmitting." },
      { code: "OCR_NOT_READY", status: 409, meaning: "The sources have not finished being read.", whatToDo: "Retry rather than fail. Poll the job's events until reading completes." },
      { code: "SECURITY_BLOCKER_REQUIRES_EXPLICIT_REMOVAL", status: 409, meaning: "`continue` was sent while a source was held by a safety check.", whatToDo: "Use `remove_blocked`, which records who removed it. `continue` will not step over a security blocker, because a pipeline that learns to skip security stops has stopped being one." },
      { code: "CORE_NOT_CONFIGURED", status: 503, meaning: "The compile runtime is unavailable. The request was not charged.", whatToDo: "Retry. /api/status reports the deployment's state." },
      { code: "CORE_UNAVAILABLE", status: 503, meaning: "The compile runtime was reachable and did not answer.", whatToDo: "Retry. Nothing was charged." },
      { code: "CORE_REQUEST_INVALID", meaning: "The compile runtime refused the request it was handed.", whatToDo: "Nothing a caller can send. Report it with the job id." },
      { code: "CORE_RECEIPT_INVALID", meaning: "The compile runtime answered with a receipt that did not validate, so the result was refused rather than stored.", whatToDo: "Retry. Fail-closed by design: a result that cannot be validated is not a smaller result." },
      { code: "COMPILE_JOB_STORE_NOT_CONFIGURED", status: 503, meaning: "The durable job store is not configured.", whatToDo: "Nothing a caller can send." },
      { code: "COMPILE_JOB_STORE_READ_FAILED", status: 503, meaning: "The durable job store could not be read.", whatToDo: "Retry." },
      { code: "COMPILE_JOB_STORE_WRITE_FAILED", status: 503, meaning: "The durable job store could not be written, so the intent was not recorded.", whatToDo: "Retry. Submitting the same set again converges on one job." },
      { code: "COMPILE_JOB_RPC_UNDEFINED", status: 503, meaning: "The job store is missing a procedure this build expects — a deployment mismatch.", whatToDo: "Nothing a caller can send. Report it." },
    ],
  },
  {
    title: "Worlds, retrieval and answers",
    summary: "Reading a World, and what Search and Ask refuse rather than weaken.",
    codes: [
      { code: "ACTIVE_WORLD_NOT_FOUND", status: 409, meaning: "Nothing has been activated for this collection, so there is no World to read, index or answer from. A candidate nobody accepted is not a smaller answer — it is a different one.", whatToDo: "Promote a candidate in a signed-in session. No key can promote." },
      { code: "ACTIVE_WORLD_CONFLICT", status: 409, meaning: "Two activations raced; neither was applied silently.", whatToDo: "Re-read the World and retry the activation." },
      { code: "WORLD_TRANSITION_IDEMPOTENCY_CONFLICT", status: 409, meaning: "The transition idempotency key was already bound to a different activation or rollback request.", whatToDo: "Reuse the key only for the identical request, or generate a fresh key after re-reading the active World." },
      { code: "WORLD_VERSION_BINDING_CONFLICT", status: 409, meaning: "The requested transition was bound to a World revision that is no longer current.", whatToDo: "Re-read the active World and submit the transition against its current revision." },
      { code: "WORLD_SOURCE_REVISION_SUPERSEDED", status: 409, meaning: "A connector source in this candidate has a newer bound revision than the one the candidate was compiled from, so promoting it would publish replaced content. Checked under lock in the same transaction as the activation.", whatToDo: "Compile again from the current sources and promote that candidate." },
      { code: "WORLD_SOURCE_REVISION_AMBIGUOUS", status: 409, meaning: "A connector source in this candidate has no single latest revision (an unresolved legacy equal-instant tie), so currency cannot be established.", whatToDo: "Let the next sync record the provider's current revision, then compile and promote again." },
      { code: "WORLD_TRANSITION_FORBIDDEN", status: 403, meaning: "The transition was refused because the current principal may no longer change this World.", whatToDo: "Refresh your session and workspace membership; an owner or admin must perform the transition." },
      { code: "ACTIVE_WORLD_CHANGED_RETRY", status: 409, meaning: "The active version changed while the request was in flight.", whatToDo: "Retry. The answer would have mixed two versions." },
      { code: "CONSUMER_CONTEXT_SNAPSHOT_MISMATCH", status: 409, meaning: "A consumer context is bound and the World snapshot does not match it: `manifest` named a digest other than the one the context resolved to, or the World moved between resolving the snapshot and serving it. Refused rather than answered from another World under this context.", whatToDo: "Omit `manifest`, or send the digest the context is bound to. For a `latest` context, retry; for a pinned one, re-pin to the current snapshot." },
      { code: "ACTIVE_WORLD_ARTIFACT_INVALID", status: 422, meaning: "The activated artifact failed validation on read, so it was refused rather than served partially.", whatToDo: "Recompile. Report it with the manifest digest." },
      { code: "ACTIVE_WORLD_BINDING_INVALID", meaning: "The active pointer names a version the store cannot resolve.", whatToDo: "Report it with the collection id." },
      { code: "ACTIVE_WORLD_RETRIEVAL_INVALID", meaning: "The active World's retrieval state did not validate.", whatToDo: "Rebuild the index with `POST /collections/{id}/retrieval-index`." },
      { code: "ACTIVE_WORLD_STORE_UNAVAILABLE", status: 503, meaning: "The World store could not be reached.", whatToDo: "Retry." },
      { code: "WORLD_NOT_FOUND", status: 404, meaning: "No World for that collection id in this workspace.", whatToDo: "Check the id, and that it belongs to your workspace." },
      { code: "WORLD_LENS_NOT_FOUND", status: 404, meaning: "The lens name is not one of `objects`, `relations`, `evidence`, `history`, `files`, `review`.", whatToDo: "Use one of the six." },
      { code: "WORLD_READ_MODEL_INVALID", status: 422, meaning: "The read model failed validation, so nothing was served.", whatToDo: "Report it with the manifest digest." },
      { code: "WORLD_STORE_NOT_CONFIGURED", status: 503, meaning: "The World store is not configured.", whatToDo: "Nothing a caller can send." },
      { code: "WORLD_STORE_READ_FAILED", status: 503, meaning: "The World store could not be read.", whatToDo: "Retry." },
      { code: "WORLD_STORE_WRITE_FAILED", status: 503, meaning: "The World store could not be written.", whatToDo: "Retry." },
      { code: "WORLD_VERSION_BINDING_INVALID", meaning: "A retained version could not be bound to its manifest.", whatToDo: "Report it with the collection id." },
      { code: "WORLD_CANDIDATE_NOT_PROMOTABLE", status: 422, meaning: "The candidate failed the checks activation requires.", whatToDo: "Read the validation report in the candidate; it names what failed." },
      { code: "WORLD_CANDIDATE_EVIDENCE_REQUIRED", status: 422, meaning: "The candidate has no readable source-bound evidence, so publication or restoration was refused.", whatToDo: "Recompile from source regions and inspect the evidence before publishing." },
      { code: "ROLLBACK_TARGET_ARTIFACT_INVALID", status: 422, meaning: "The retained rollback artifact does not match its collection, manifest or qualified runtime.", whatToDo: "Choose a valid retained version from World history; report a damaged artifact." },
      { code: "WORLD_CANDIDATE_SOURCE_BINDING_INVALID", status: 422, meaning: "A candidate object cites a source version the store cannot resolve.", whatToDo: "Recompile. A World with an unresolved link is not emitted." },
      { code: "WORLD_EQUIVALENCE_REFUSED", status: 409, meaning: "The activation would have replaced the active World with one the equivalence check does not accept as the same subject.", whatToDo: "Review the diff before promoting." },
      { code: "EVIDENCE_DANGLING", meaning: "An object cites evidence that is not in the package.", whatToDo: "Recompile. Fail-closed: the World is not emitted rather than emitted incomplete." },
      { code: "ROLLBACK_TARGET_NOT_FOUND", status: 404, meaning: "The version to roll back to is not retained.", whatToDo: "Read the `history` lens for the versions that are." },
      { code: "ROLLBACK_TARGET_CONFLICT", status: 409, meaning: "The rollback target no longer matches the retained history or active revision used to authorize the request.", whatToDo: "Re-read the World history and choose a target from the current response." },
      { code: "PROMOTION_ROLE_REQUIRED", status: 403, meaning: "Activation needs the workspace owner or admin role.", whatToDo: "Ask an owner or admin to activate." },
      { code: "ROLLBACK_ROLE_REQUIRED", status: 403, meaning: "Rollback needs the workspace owner or admin role.", whatToDo: "Ask an owner or admin to roll back." },
      { code: "RETRIEVAL_COMPILE_ROLE_REQUIRED", status: 403, meaning: "Rebuilding the retrieval index needs the workspace owner or admin role, on top of the scope.", whatToDo: "Ask an owner or admin to rebuild." },
      { code: "RETRIEVAL_RUN_NOT_FOUND", status: 409, meaning: "The active World has no completed retrieval compile run, so there is no queryable index. Search has no fallback — a weaker answer presented as the real one is worse than a refusal you can act on.", whatToDo: "`POST /collections/{id}/retrieval-index` rebuilds it. The body carries `retrievalIndex` and `retrievalNotice` saying which state it is in." },
      { code: "RETRIEVAL_PROFILE_NOT_FOUND", status: 409, meaning: "The retrieval profile the index was compiled against is not registered.", whatToDo: "Rebuild the index." },
      { code: "RETRIEVAL_INDEX_NOT_COMPILED", status: 503, meaning: "A rebuild did not reach a queryable index. `retrievalIndex.errorClass` names the failure class. Never answered as a 200.", whatToDo: "Read `errorClass`, then retry. An embedder outage and an empty corpus are different problems." },
      { code: "RETRIEVAL_RUNTIME_UNAVAILABLE", status: 503, meaning: "The exact retrieval runtime bound to this compiled index is unavailable or failed its identity checks, so the request was refused instead of silently using a different model.", whatToDo: "Retry after the configured runtime is restored, or rebuild the index against an available registered profile." },
      { code: "RETRIEVAL_COMPILE_NO_UNITS", meaning: "The World produced no retrievable units, so there was nothing to index.", whatToDo: "Check the compile: a World with no evidence has nothing to retrieve." },
      { code: "RETRIEVAL_COMPILE_EMBEDDING_PROVIDER_FAILED", meaning: "The embedding provider failed during the rebuild.", whatToDo: "Retry. Dense retrieval is skipped rather than faked when no embedder is configured — see `degradations`." },
      { code: "RETRIEVAL_COMPILE_EMBEDDING_WRITE_FAILED", meaning: "Embeddings could not be written.", whatToDo: "Retry." },
      { code: "RETRIEVAL_COMPILE_UNIT_WRITE_FAILED", meaning: "Retrieval units could not be written.", whatToDo: "Retry." },
      { code: "RETRIEVAL_COMPILE_PROFILE_REGISTRATION_FAILED", meaning: "The retrieval profile could not be registered.", whatToDo: "Retry." },
      { code: "RETRIEVAL_COMPILE_RUN_REJECTED", meaning: "The rebuild run was refused before it started.", whatToDo: "Check the active World exists and the plan bar is met." },
      { code: "RETRIEVAL_COMPILE_SOURCE_BINDING_UNRESOLVED", meaning: "A retrieval unit cited a source version that could not be resolved, so the index was refused rather than compiled with a dangling citation.", whatToDo: "Recompile the World." },
    ],
  },
  {
    title: "Review and evidence",
    summary: "The append-only decision record, and what it revalidates before it writes.",
    codes: [
      { code: "REVIEW_REQUEST_INVALID", status: 400, meaning: "The review body did not validate.", whatToDo: "Check the schema: `collectionId`, `manifestDigest`, `evidenceId`, `action` and an 8–1000 character `reason` are all required." },
      { code: "REVIEW_REQUEST_TOO_LARGE", status: 413, meaning: "The review body exceeded its bound.", whatToDo: "Shorten the reason." },
      { code: "REVIEW_EVIDENCE_NOT_FOUND", status: 404, meaning: "The evidence id is not in the World version named by the digest.", whatToDo: "Read the `evidence` lens for that manifest digest and use an id from it." },
      { code: "REVIEW_WORLD_CHANGED", status: 409, meaning: "The World changed between reading the evidence and recording the decision, so the decision was not written against a version it may not describe.", whatToDo: "Re-read the evidence at the current digest and decide again." },
      { code: "REVIEW_PATCH_INVALID", status: 400, meaning: "An Edit decision carried a patch that did not validate.", whatToDo: "Check the patch shape against the evidence you read." },
      { code: "REVIEW_RECEIPT_INVALID", meaning: "The decision receipt did not validate, so nothing was recorded.", whatToDo: "Retry. Nothing partial was written." },
      { code: "REVIEW_STORE_NOT_CONFIGURED", status: 503, meaning: "The review store is not configured.", whatToDo: "Nothing a caller can send." },
      { code: "REVIEW_STORE_READ_FAILED", status: 503, meaning: "The review store could not be read.", whatToDo: "Retry." },
      { code: "REVIEW_STORE_WRITE_FAILED", status: 503, meaning: "The review store could not be written.", whatToDo: "Retry. The record is append-only, so a retry does not overwrite." },
      { code: "PATCH_BEFORE_MISMATCH", status: 409, meaning: "The patch's `before` value does not match what is stored now.", whatToDo: "Re-read the target and rebuild the patch." },
      { code: "PATCH_TARGET_NOT_FOUND", status: 404, meaning: "The patch names a target the World does not contain.", whatToDo: "Re-read the World." },
      { code: "PATCH_TARGET_NOT_EDITABLE", status: 409, meaning: "The target is not one a review decision may edit.", whatToDo: "Accept or Reject instead." },
      { code: "PATCH_NO_CHANGE", status: 400, meaning: "The patch would change nothing.", whatToDo: "Send a patch that differs, or record Accept." },
      { code: "PATCH_LABEL_INVALID", status: 400, meaning: "The patch label did not validate.", whatToDo: "Check the label bounds." },
      { code: "PATCH_ARTIFACT_INVALID", status: 422, meaning: "Applying the patch would produce an artifact that does not validate.", whatToDo: "Fail-closed by design. Narrow the edit." },
      { code: "REJECT_RECEIPT_INVALID", meaning: "A Reject decision's receipt did not validate.", whatToDo: "Retry." },
    ],
  },
  {
    title: "Exports and packages",
    summary: "Signed, or refused. There is no third outcome.",
    codes: [
      { code: "EXPORT_SIGNER_NOT_CONFIGURED", status: 503, meaning: "No signing key is configured, so neither a signed archive nor a fingerprint can be produced. `GET /export/trust` answers this rather than a fingerprint nobody can verify against.", whatToDo: "Nothing a caller can send. A deployment without a signer cannot hand out an archive at all — that is the contract, not an outage." },
      { code: "EXPORT_SIGNER_INVALID", status: 503, meaning: "The configured signer did not produce a usable key.", whatToDo: "Nothing a caller can send. Report it." },
      { code: "SIGNATURE_READ_FAILED", status: 503, meaning: "The detached signature could not be read.", whatToDo: "Retry the download." },
      { code: "INVALID_SIGNATURE", status: 422, meaning: "The signature did not verify against the key it names.", whatToDo: "Do not trust the archive. Re-download, and verify against the fingerprint from `GET /export/trust` rather than one inside the archive." },
      { code: "COLLECTION_PACKAGE_INVALID", status: 422, meaning: "The package failed its own validation, so it was not served.", whatToDo: "Recompile. A package whose file digests do not match is not served." },
      { code: "COLLECTION_KEY_INVALID", status: 400, meaning: "The package object key did not validate.", whatToDo: "Report it with the collection id." },
      { code: "COLLECTION_SOURCE_BINDING_INVALID", status: 422, meaning: "A package entry cites a source version that cannot be resolved.", whatToDo: "Recompile." },
      { code: "COLLECTION_JSON_PREFIX_REQUIRED", meaning: "The package store is configured with a prefix the request did not use.", whatToDo: "Nothing a caller can send. Report it." },
      { code: "R2_NOT_CONFIGURED", status: 503, meaning: "Object storage is not configured.", whatToDo: "Nothing a caller can send." },
      { code: "DELETION_NOT_PROVEN", meaning: "A delete was requested and the store could not prove it happened, so success was not reported.", whatToDo: "Retry. Fail-closed: an unproven delete is not reported as a delete." },
      { code: "RESTORE_NOT_PROVEN", meaning: "A restore could not be proven.", whatToDo: "Retry." },
    ],
  },
  {
    title: "Connections and connectors",
    summary: "Durable cursors, and the refusals that keep two syncs from disagreeing.",
    codes: [
      { code: "GOOGLE_VIEWER_LINK_NOT_ENABLED", status: 503, meaning: "Google Drive identity linking is not enabled.", whatToDo: "Use an enabled connector or retry after this integration is configured." },
      { code: "GOOGLE_VIEWER_LINK_CONSENT_INVALID", meaning: "The Google consent response did not prove the requested viewer-only access and consent state.", whatToDo: "Restart authorization and grant the requested viewer-only permission." },
      { code: "OAUTH_REFRESH_TOKEN_MISSING", meaning: "The OAuth provider returned no refresh token for a connector that requires persistent access.", whatToDo: "Re-authorize the connector with the provider's offline access consent enabled." },
      { code: "CONNECTION_NOT_FOUND", status: 404, meaning: "No such connection in this workspace.", whatToDo: "List `GET /connections`." },
      { code: "CONNECTION_NOT_SYNCABLE", status: 409, meaning: "The connection is revoked or in a state that does not accept a batch.", whatToDo: "Re-create the connection." },
      { code: "CONNECTION_CREATE_FAILED", status: 503, meaning: "The connection could not be recorded.", whatToDo: "Retry." },
      { code: "CONNECTION_REVOKE_FAILED", status: 503, meaning: "The revoke could not be recorded, so it is not reported as done. Immutable outputs are retained by design when a revoke does succeed.", whatToDo: "Retry. A revoke that cannot be proven is not reported as a revoke." },
      { code: "CONNECTION_BATCH_CONFLICT", status: 409, meaning: "The batch's `previousCursorSha256` does not match the committed cursor — another sync moved it.", whatToDo: "Re-read the connection's cursor and rebuild the batch from it." },
      { code: "CONNECTION_CURSOR_CONFLICT", status: 409, meaning: "Two batches tried to advance the same cursor.", whatToDo: "Re-read the cursor and retry. Replaying the identical batch is idempotent." },
      { code: "CONNECTION_BATCH_FAILED", status: 503, meaning: "The batch could not be applied.", whatToDo: "Retry with the same `batchId`: an identical replay is idempotent, not a second apply." },
      { code: "INVENTORY_CONTRACT_INVALID", status: 400, meaning: "An inventory scan step did not match its schema: unknown field, bad scan id, counts that cannot be paged, or an epoch that does not exceed the expected head.", whatToDo: "Check the `ConnectionInventoryRequest` schema." },
      { code: "INVENTORY_ITEM_INVALID", status: 400, meaning: "An inventory item failed validation (id or revision bounds, digest, size or MIME type).", whatToDo: "Check the `ConnectionInventoryItem` schema bounds." },
      { code: "INVENTORY_PAGE_INDEX_INVALID", status: 400, meaning: "The page index is outside the scan's declared page count.", whatToDo: "Send pages 0 to pageCount - 1." },
      { code: "INVENTORY_NOT_ATTESTED_COMPLETE", status: 400, meaning: "finalize was sent without `complete: true`. An incomplete scan never marks anything missing.", whatToDo: "Finalize only after the whole source was read; otherwise abandon the scan." },
      { code: "INVENTORY_ACTOR_INVALID", status: 403, meaning: "The key or user no longer holds this workspace with `connections:sync`.", whatToDo: "Use an active key with the `connections:sync` scope." },
      { code: "INVENTORY_HEAD_STALE", status: 409, meaning: "`expectedHeadEpoch` is not the connection's current inventory head; another scan finalized first. The response carries `headEpoch`.", whatToDo: "Begin a new scan naming the returned `headEpoch`." },
      { code: "INVENTORY_EPOCH_STALE", status: 409, meaning: "An open scan with an equal or newer epoch exists; an older scan cannot replace it.", whatToDo: "Use a larger `scanEpoch`, or let the newer scan finish." },
      { code: "INVENTORY_SCAN_CONFLICT", status: 409, meaning: "The scan id was already begun with different parameters.", whatToDo: "Use a new scan id." },
      { code: "INVENTORY_SCAN_NOT_FOUND", status: 409, meaning: "No such scan on this connection in this workspace.", whatToDo: "Begin a scan first." },
      { code: "INVENTORY_SCAN_NOT_OPEN", status: 409, meaning: "The scan was finalized or superseded by a newer one and accepts no more steps.", whatToDo: "Begin a new scan." },
      { code: "INVENTORY_SCAN_EXPIRED", status: 409, meaning: "The scan stayed open past its six-hour limit and was abandoned.", whatToDo: "Begin a new scan." },
      { code: "INVENTORY_PAGE_CONFLICT", status: 409, meaning: "A page with this index was already staged with different items. An identical page is a replay, not a conflict.", whatToDo: "Begin a new scan; a scan's pages are immutable." },
      { code: "INVENTORY_COUNT_MISMATCH", status: 409, meaning: "The staged or restated item/page counts disagree with the counts declared at begin.", whatToDo: "Begin a new scan with the correct counts." },
      { code: "INVENTORY_PAGES_INCOMPLETE", status: 409, meaning: "finalize was sent before every declared page was staged.", whatToDo: "Stage the missing pages, then finalize." },
      { code: "INVENTORY_DUPLICATE_ITEM", status: 409, meaning: "The same `nativeId` appears more than once in the scan.", whatToDo: "Deduplicate the inventory and begin a new scan." },
      { code: "INVENTORY_FINALIZE_CONFLICT", status: 409, meaning: "The scan was already finalized with different counts.", whatToDo: "Read the stored receipt with an identical finalize, or begin a new scan." },
      { code: "INVENTORY_LIMIT_EXCEEDED", status: 413, meaning: "The scan's staged pages passed the 64 MiB per-scan bound.", whatToDo: "Split the source into smaller registered scopes." },
      { code: "INVENTORY_UNAVAILABLE", status: 503, meaning: "The inventory step could not be recorded or classified, so it is not reported as done.", whatToDo: "Retry the identical step: begin, page and finalize replays are idempotent." },
      { code: "SOURCE_CURSOR_STALE", status: 409, meaning: "The cursor the batch carries is behind the committed one.", whatToDo: "Re-read the cursor and collect from there." },
      { code: "SOURCE_CURSOR_TOO_LARGE", status: 413, meaning: "The cursor value exceeded its bound.", whatToDo: "Report it with the connection id." },
      { code: "SOURCE_DIGEST_REQUIRED", status: 400, meaning: "An event carried bytes with no `contentSha256`.", whatToDo: "Compute the digest at the source. An event without one cannot be bound to a document." },
      { code: "SOURCE_DIGEST_MISMATCH", status: 409, meaning: "The bytes do not hash to the digest the event declared.", whatToDo: "Re-read the file and recompute the digest." },
      { code: "SOURCE_DIGEST_CONFLICT", status: 409, meaning: "Two events declare different digests for the same revision.", whatToDo: "Re-collect the revision." },
      { code: "SOURCE_IDENTITY_INVALID", status: 400, meaning: "The event's `nativeId`/`revision` pair did not validate.", whatToDo: "Check the `ConnectionEvent` schema bounds." },
      { code: "SOURCE_REVISION_MISMATCH", status: 409, meaning: "The revision the event names is not the one recorded.", whatToDo: "Re-read the cursor and collect again." },
      { code: "SOURCE_VERSION_CHANGED", status: 409, meaning: "The source version changed under the batch.", whatToDo: "Retry from the committed cursor." },
      { code: "SOURCE_VERSION_DIGEST_CONFLICT", status: 409, meaning: "A version is already recorded with a different digest.", whatToDo: "Re-collect the version." },
      { code: "SOURCE_METADATA_INVALID", status: 400, meaning: "Event metadata did not validate.", whatToDo: "Check the `ConnectionEvent` schema." },
      { code: "SOURCE_LIFECYCLE_REVIEW_REQUIRED", status: 409, meaning: "A lifecycle transition on this source needs a person.", whatToDo: "Nothing automatic clears it." },
      { code: "SOURCE_DOWNLOAD_FAILED", status: 503, meaning: "The agent could not read the source's bytes.", whatToDo: "Check the agent's credentials and the source's availability." },
      { code: "CONNECTOR_SOURCE_ACCESS_DENIED", status: 401, meaning: "The provider refused the stored credential.", whatToDo: "Re-authorize the connector." },
      { code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE", status: 503, meaning: "The provider could not be reached.", whatToDo: "Retry." },
      { code: "CONNECTOR_SOURCE_SUSPENSION_UNRESOLVED", status: 409, meaning: "The connector is suspended and the suspension has not been cleared.", whatToDo: "Re-authorize, or revoke and re-create the connection." },
      { code: "CONNECTOR_BINDING_INVALID", meaning: "The connector binding did not validate.", whatToDo: "Re-create the connection." },
      { code: "CONNECTOR_BINDING_CONFLICT", status: 409, meaning: "Two bindings claim the same connector.", whatToDo: "Revoke one." },
      { code: "OAUTH_PROVIDER_NOT_CONFIGURED", status: 503, meaning: "The provider's client is not configured. Fails closed rather than starting an authorization that cannot complete.", whatToDo: "Check /integrations for which providers are live here." },
      { code: "OAUTH_SECRET_BROKER_NOT_CONFIGURED", status: 503, meaning: "The managed secret broker is not configured, so no refresh secret could be stored — or, on a revoke, deleted.", whatToDo: "Nothing a caller can send." },
      { code: "OAUTH_AUTHORIZATION_START_FAILED", status: 503, meaning: "The single-use PKCE authorization could not be created.", whatToDo: "Retry." },
      { code: "OAUTH_AUTHORIZATION_INVALID", status: 400, meaning: "The authorization is expired, already used, or does not match this workspace. Authorizations are single-use by design.", whatToDo: "Start a new authorization." },
      { code: "OAUTH_PROVIDER_DENIED", status: 403, meaning: "The user declined at the provider.", whatToDo: "Start the authorization again." },
      { code: "OAUTH_PROVIDER_INVALID", meaning: "The callback path named a provider TAVONEL does not have a connector for. Carried back on the workspace redirect rather than as a JSON body.", whatToDo: "Start the authorization from `POST /oauth-connectors/authorize`; do not construct the callback URL yourself." },
      { code: "OAUTH_CALLBACK_INVALID", status: 400, meaning: "The callback did not carry a state TAVONEL issued.", whatToDo: "Start the authorization again; do not construct the callback yourself." },
      { code: "OAUTH_CALLBACK_FAILED", status: 503, meaning: "The callback could not be completed.", whatToDo: "Start the authorization again." },
      { code: "OAUTH_CONNECTION_NOT_FOUND", status: 404, meaning: "No such OAuth connection in this workspace.", whatToDo: "List `GET /oauth-connectors`." },
      { code: "OAUTH_SECRET_REVOCATION_FAILED", status: 503, meaning: "The refresh secret could not be deleted, so the revoke was not reported as done.", whatToDo: "Retry. A revoke is reported only when the secret is gone." },
      { code: "OAUTH_TOKEN_REFRESH_FAILED", status: 503, meaning: "The provider refused the refresh token.", whatToDo: "Re-authorize the connector." },
      { code: "OAUTH_SOURCE_TARGET_UNSUPPORTED", status: 400, meaning: "The requested source target is not one this connector reads.", whatToDo: "Check /integrations for what each provider covers here." },
      { code: "OAUTH_STORE_NOT_CONFIGURED", status: 503, meaning: "The OAuth store is not configured.", whatToDo: "Nothing a caller can send." },
      { code: "OAUTH_STORE_UNAVAILABLE", status: 503, meaning: "The OAuth store could not be reached.", whatToDo: "Retry." },
      { code: "JOB_NOT_FOUND", status: 404, meaning: "No such run in this workspace.", whatToDo: "Use a run id from the response that started it." },
      { code: "JOB_SCOPE_INVALID", status: 404, meaning: "The run exists and belongs to another workspace. Answered as not found rather than as forbidden, so an id cannot be probed across tenants.", whatToDo: "Use a run from your own workspace." },
      { code: "JOB_SYNC_CONFLICT", status: 409, meaning: "Two syncs raced on the same run.", whatToDo: "Retry." },
      { code: "JOB_CONNECTION_MISSING", status: 409, meaning: "The run names a connection that no longer exists.", whatToDo: "Re-create the connection." },
      { code: "JOB_CONNECTION_UNAVAILABLE", status: 503, meaning: "The run's connection could not be read.", whatToDo: "Retry." },
      { code: "JOB_CURSOR_INVALID", status: 400, meaning: "The run's cursor did not validate.", whatToDo: "Restart the sync from the committed cursor." },
      { code: "JOB_STORE_READ_FAILED", status: 503, meaning: "The run store could not be read.", whatToDo: "Retry." },
      { code: "JOB_STORE_WRITE_FAILED", status: 503, meaning: "The run store could not be written.", whatToDo: "Retry." },
    ],
  },
  {
    title: "Keys and audit",
    summary: "Management routes, which no API key can call — they take a signed-in browser session.",
    codes: [
      { code: "API_KEY_NOT_FOUND", status: 404, meaning: "No such key in this workspace.", whatToDo: "List the keys in Workspace → Developers." },
      { code: "API_KEY_CREATE_FAILED", status: 503, meaning: "The replacement key could not be written, so nothing was revoked either.", whatToDo: "Retry. Rotation is atomic: either both happened or neither did." },
      { code: "API_KEY_ROTATE_FAILED", status: 503, meaning: "The rotation could not be completed.", whatToDo: "Retry, then check which keys exist before assuming either outcome." },
      { code: "API_KEY_REVOKE_FAILED", status: 503, meaning: "The revoke could not be recorded.", whatToDo: "Retry. A revoke is reported only when it is written." },
      { code: "DEVELOPER_STORE_NOT_CONFIGURED", status: 503, meaning: "The developer store is not configured.", whatToDo: "Nothing a caller can send." },
      { code: "DEVELOPER_STORE_READ_FAILED", status: 503, meaning: "The developer store could not be read.", whatToDo: "Retry." },
      { code: "DEVELOPER_STORE_BINDING_INVALID", status: 503, meaning: "A stored row did not validate, so it was refused rather than returned partially.", whatToDo: "Report it." },
      { code: "DEVELOPER_AUDIT_READ_FAILED", status: 503, meaning: "The audit trail could not be read.", whatToDo: "Retry." },
      { code: "DEVELOPER_AUDIT_WRITE_FAILED", status: 503, meaning: "An audit event could not be written, so the action it describes was refused. Every key create, rotate and revoke writes an audit row or does not happen.", whatToDo: "Retry." },
    ],
  },
  {
    title: "Source export and deletion",
    summary: "`/api/documents/{id}/lifecycle`: what a workspace manager is told when exporting or deleting an uploaded source.",
    codes: [
      { code: "CUSTOMER_SOURCE_DELETE_SESSION_REQUIRED", status: 403, meaning: "Deleting a source needs a signed-in person; an API key cannot delete.", whatToDo: "Sign in as a workspace owner or admin and retry from the workspace." },
      { code: "WORKSPACE_MANAGER_REQUIRED", status: 403, meaning: "Only a workspace owner or admin can plan or request a deletion.", whatToDo: "Ask an owner or admin of this workspace." },
      { code: "DELETION_MODE_INVALID", status: 400, meaning: "`mode` was neither `dry_run` nor `execute`.", whatToDo: "Send `dry_run` first, then `execute` with the plan's digest." },
      { code: "CUSTOMER_SOURCE_NOT_AN_UPLOAD", status: 400, meaning: "The id is not an uploaded source, so this route cannot delete it. Connected sources are deleted at their origin.", whatToDo: "Delete the file in the connected provider." },
      { code: "CONFIRM_MANIFEST_REQUIRED", status: 400, meaning: "`execute` must echo the `manifestSha256` of the dry-run plan.", whatToDo: "Run `dry_run`, then send its `manifestSha256` as `confirmManifestSha256`." },
      { code: "CUSTOMER_SOURCE_MANIFEST_CHANGED", status: 409, meaning: "The stored objects changed since the plan you confirmed, so nothing was deleted. The body carries the new plan.", whatToDo: "Review the new plan and confirm its digest." },
      { code: "CUSTOMER_SOURCE_DELETE_FORBIDDEN", status: 403, meaning: "The database re-checked membership and the caller is not an active owner or admin of this workspace.", whatToDo: "Ask an owner or admin of this workspace." },
      { code: "CUSTOMER_SOURCE_CONNECTOR_BOUND", status: 409, meaning: "The document came from a connected provider; deleting it here would be undone by the next sync.", whatToDo: "Delete the file in the provider." },
      { code: "SOURCE_LEGAL_HOLD_ACTIVE", status: 409, meaning: "A legal hold covers this workspace, so no source in it can be deleted.", whatToDo: "The hold has to be released first; contact your administrator or TAVONEL." },
      { code: "SOURCE_LEGAL_HOLD_STATE_UNKNOWN", status: 409, meaning: "The workspace's legal-hold state could not be read, so deletion is refused rather than assumed safe.", whatToDo: "Contact TAVONEL; this is a configuration problem, not something a retry fixes." },
      { code: "CUSTOMER_SOURCE_DELETE_STORE_FAILED", status: 503, meaning: "The deletion ledger could not be read or written. Nothing was recorded.", whatToDo: "Retry; a retry of a recorded request replays the same receipt." },
    ],
  },
  {
    title: "Generic",
    summary: "Codes that are deliberately vague, and what that vagueness means.",
    codes: [
      { code: "NOT_FOUND", meaning: "The addressed resource does not exist in this workspace. Deliberately uniform across tenants: the same answer for an id that is not yours and an id that is nobody's.", whatToDo: "Check the id, and that it belongs to the workspace the key names." },
      { code: "READ_FAILED", status: 503, meaning: "A backing store could not be read.", whatToDo: "Retry." },
      { code: "DELETE_FAILED", status: 503, meaning: "A delete could not be completed.", whatToDo: "Retry." },
      { code: "IDEMPOTENCY_KEY_INVALID", status: 400, meaning: "The idempotency key did not match the expected shape.", whatToDo: "Send a sha256 hex digest, or omit the header." },
      { code: "IDEMPOTENCY_CONFLICT", status: 409, meaning: "The same idempotency key was used for a different request body.", whatToDo: "Use a fresh key, or re-send the original body." },
      { code: "IDEMPOTENCY_IN_PROGRESS", status: 409, meaning: "A request with this key is still running.", whatToDo: "Poll rather than resubmit." },
      { code: "COMPUTE_IDEMPOTENCY_CONFLICT", status: 409, meaning: "The processing reservation ledger already holds a different reservation under this request's idempotency key.", whatToDo: "Use a fresh source idempotency key, or re-send the original request unchanged. Nothing was charged twice." },
      { code: "CONTENT_LENGTH_INVALID", status: 400, meaning: "`content-length` was absent or unparseable where the route requires it.", whatToDo: "Send an accurate `content-length`." },
      { code: "CONTENT_LENGTH_MISMATCH", status: 400, meaning: "The body length did not match the declared `content-length`.", whatToDo: "Send an accurate `content-length`." },
    ],
  },
] as const;

/** The catalogue, flat. The page renders the groups; the spec and the tests want the list. */
export const API_ERROR_CODES: readonly ApiErrorCode[] = API_ERROR_GROUPS.flatMap((group) => group.codes);

export const API_ERROR_CODE_NAMES: readonly string[] = API_ERROR_CODES.map((entry) => entry.code);

const BY_CODE = new Map(API_ERROR_CODES.map((entry) => [entry.code, entry]));

/**
 * Look one up, and fail loudly on a name that is not catalogued.
 *
 * The OpenAPI document builds every error description through this, so a spec that names a code
 * the catalogue has never heard of is a build failure rather than a published fiction.
 */
export function apiErrorCode(code: string): ApiErrorCode {
  const entry = BY_CODE.get(code);
  if (!entry) throw new Error(`${code} is not in lib/api-error-codes.ts`);
  return entry;
}

/**
 * Codes that ride in the same `code` field on a success.
 *
 * They are not errors and they are not documented as errors, but the scan that guards the
 * catalogue sees them in the same position, so they are named here rather than being swept into
 * the catalogue with an invented meaning.
 */
export const API_RESULT_CODES: readonly string[] = [
  "OK",
  "CREATED",
  "QUALIFIED",
  "RECORDED",
  "ROTATED",
  "UPDATED",
  "ACQUIRED",
  "REPLAY",
  "COLLECTIONS_LISTED",
  "COLLECTION_CANDIDATE_READY",
  "MANIFEST_STATUS",
  "COMPILE_JOB_ACCEPTED",
  "COMPILE_CORPUS_ACCEPTED",
  "GROUNDED_ANSWER",
  "ANSWER_ABSTAINED",
  "SEARCH_RESULTS",
  "SEARCH_EMPTY",
  "RETRIEVAL_INDEX_COMPILED",
  "WORLD_ACTIVE",
  "WORLD_ROLLED_BACK",
  "AUTHORIZED_REDIRECT_READY",
  "UPLOAD_CONFIRMED",
  "UPLOAD_ALREADY_STORED",
  "GOOGLE_VIEWER_LINKS_REVOKED",
  "TRIAGE_FILE_SEALED",
  "TRIAGE_PREFLIGHT_APPROVED",
  "TRIAGE_RECEIPT_READY",
  "TRIAGE_REVIEW_REQUIRED",
  "TRIAGE_STAGE_READY",
  "TRIAGE_OBJECT_READY",
  "ONE_SHOT_QUALIFICATION_ALLOWED",
  "DELETION_RECORDED",
  "CUSTOMER_SOURCE_DELETION_ALREADY_RECORDED",
  "CUSTOMER_SOURCE_DELETION_SCHEDULED",
  "INTAKE_APPROVAL",
  "INTAKE_QUOTE",
  "INTAKE_APPROVED",
  "INTAKE_SET_CANCELLED",
  "INTAKE_SET_CANCELLED_RECONCILIATION_REQUIRED",
  "UPLOAD_CREDITS_RELEASED",
];

/**
 * The files `lib/api-error-codes.test.ts` scans.
 *
 * Every handler that serves an operation in the published contract, plus the three modules those
 * handlers get a code from without writing it themselves: the authorizer (`AUTH_REQUIRED`,
 * `API_SCOPE_REQUIRED`), the store that owns the per-minute rate window, and the hourly
 * activation window. The `/api/v1/*` routes mostly delegate to an `/api/*` handler, so both
 * sides of each delegation are in the list.
 */
export const API_ERROR_SCAN_ROOTS: readonly string[] = [
  "app/api/v1",
  "app/api/compile-jobs",
  "app/api/collections",
  "app/api/documents",
  "app/api/uploads/capability",
  "app/api/uploads/approval",
  "app/api/uploads/confirm",
  "app/api/uploads/release",
  "app/api/connections",
  "app/api/export",
  "lib/developer-auth.ts",
  "lib/world-rollback-source-access.ts",
  "lib/developer-store.ts",
  "lib/connection-source-inventory.ts",
  "lib/activation-rate-limit.ts",
];
