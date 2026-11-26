#!/usr/bin/env node
/**
 * Foundation entry-path census, 15 strata (WO-CEN-1).
 *
 * For every stratum x file extension x entry path (upload, archive, source_agent, connector) this
 * runs the repository's own validation functions on generated synthetic fixtures and records what
 * came back. No verdict is typed here: each one is mapped from a function's return value, and a
 * refusal that arrives without a code stops the run (CENSUS_REFUSAL_WITHOUT_CODE). What could not
 * be run is `not_run:<reason>` / `not_computed:<reason>`, never supported or unsupported.
 *
 *   node --experimental-transform-types --import ./scripts/router/register-ts-loader.mjs \
 *     scripts/format-census.mjs --out <dir>
 *
 * Internal receipt only: nothing here is public copy.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zipSync } from "fflate";

import { CAPABILITY_MANIFEST, DECLARED_INPUT_MANIFEST, TEXT_INPUTS_LIVE } from "../../shared/capabilityManifest.ts";
import { PROCESSING_CEILING } from "../../shared/intakeCeiling.ts";
import { validateQualifiedDocumentInput } from "../../shared/qualifiedDocumentInputs.ts";
import { MAX_FILES, MAX_SYNC_ARCHIVE_BYTES, expandArchive, inspectCentralDirectory } from "../lib/archive-expand.ts";
import { listOAuthSourcePage } from "../lib/connector-oauth-adapters.ts";
import { listGoogleDriveLifecyclePage } from "../lib/google-drive-lifecycle.ts";
import { verifySourceSignature } from "../lib/magic-bytes.ts";
import { importDescriptor } from "../lib/source-import.ts";
import { quoteIntakeFile } from "../lib/usage-pricing.ts";
import { prepareWorkspaceSelection } from "../lib/workspace-intake.ts";

export const CENSUS_SCHEMA = "tavonel.format-census.v1";
export const PATHS = ["upload", "archive", "source_agent", "connector_dropbox", "connector_microsoft_graph", "connector_google_drive"];
const NEXTJS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/*
  Probe inputs, not verdicts: which extensions each stratum stands for, and the MIME a browser
  would plausibly declare for it. The MIME is recorded in the output beside every row. `tabular`
  marks strata whose native structure is cells, so "accepted but cells lost" can be computed
  against the manifest's `preserved` list. Strata 1-15 are CIP section 1 (core-intake-parsers.md).
*/
const OOXML = "application/vnd.openxmlformats-officedocument";
const x = (ext, mime) => ({ ext, mime });
export const STRATA = [
  { id: 1, name: "pdf_text_layer", exts: [x("pdf", "application/pdf")] },
  { id: 2, name: "pdf_image_only", exts: [x("pdf", "application/pdf")] },
  { id: 3, name: "docx", exts: [x("docx", `${OOXML}.wordprocessingml.document`)] },
  { id: 4, name: "xlsx", tabular: true, exts: [x("xlsx", `${OOXML}.spreadsheetml.sheet`)] },
  { id: 5, name: "pptx", exts: [x("pptx", `${OOXML}.presentationml.presentation`)] },
  { id: 6, name: "html", exts: [x("html", "text/html"), x("htm", "text/html")] },
  { id: 7, name: "subtitles", exts: [x("srt", "application/x-subrip"), x("vtt", "text/vtt")] },
  { id: 8, name: "csv", tabular: true, exts: [x("csv", "text/csv")] },
  { id: 9, name: "plain_text_markdown", exts: [x("txt", "text/plain"), x("md", "text/markdown")] },
  {
    id: 10, name: "raster_image",
    exts: [x("png", "image/png"), x("jpg", "image/jpeg"), x("jpeg", "image/jpeg"), x("webp", "image/webp"),
      x("tif", "image/tiff"), x("tiff", "image/tiff"), x("gif", "image/gif")],
  },
  {
    id: 11, name: "opendocument",
    exts: [x("odt", "application/vnd.oasis.opendocument.text"), x("ods", "application/vnd.oasis.opendocument.spreadsheet"),
      x("odp", "application/vnd.oasis.opendocument.presentation")],
  },
  {
    id: 12, name: "legacy_macro_office",
    exts: [x("doc", "application/msword"), x("xls", "application/vnd.ms-excel"), x("ppt", "application/vnd.ms-powerpoint"),
      x("docm", "application/vnd.ms-word.document.macroEnabled.12"),
      x("xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"),
      x("pptm", "application/vnd.ms-powerpoint.presentation.macroEnabled.12")],
  },
  {
    id: 13, name: "hwp_family",
    exts: [x("hwp", "application/x-hwp"), x("hwpx", "application/vnd.hancom.hwpx"), x("hml", "application/x-hwpml")],
  },
  { id: 14, name: "email", exts: [x("eml", "message/rfc822"), x("msg", "application/vnd.ms-outlook")] },
  { id: 15, name: "archive", exts: [x("zip", "application/zip"), x("rar", "application/vnd.rar"), x("7z", "application/x-7z-compressed")] },
  {
    id: 16, name: "everything_else",
    exts: [x("json", "application/json"), x("exe", "application/x-msdownload"), x("mp4", "video/mp4"),
      x("bin", "application/octet-stream"), x("svg", "image/svg+xml"), x("rtf", "application/rtf")],
  },
];

const HEADERS = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a],
  zip: [0x50, 0x4b, 0x03, 0x04],
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  tiff: [0x49, 0x49, 0x2a, 0x00],
  gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
};
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // password-protected OOXML is wrapped in this
const ascii = (text) => [...Buffer.from(text, "latin1")];
const bytes = (...parts) => Uint8Array.from(parts.flat());
const FAMILY = (mime) => (mime === "application/pdf" ? "pdf"
  : mime.startsWith(`${OOXML}.`) || mime.startsWith("application/vnd.oasis.opendocument.") ? "zip"
    : mime === "image/jpeg" ? "jpeg" : mime === "image/png" ? "png" : mime === "image/tiff" ? "tiff" : mime === "image/gif" ? "gif" : null);

export const realDeps = {
  validateInput: validateQualifiedDocumentInput,
  verifySignature: verifySourceSignature,
  quoteFile: quoteIntakeFile,
  expand: expandArchive,
  inspect: inspectCentralDirectory,
  prepareSelection: prepareWorkspaceSelection,
  describeImport: importDescriptor,
  listSource: listOAuthSourcePage,
  listGoogle: listGoogleDriveLifecyclePage,
  liveManifest: CAPABILITY_MANIFEST,
  declaredManifest: DECLARED_INPUT_MANIFEST,
  readText: (relative) => {
    try { return readFileSync(path.join(NEXTJS_ROOT, relative), "utf8"); } catch { return ""; }
  },
  git: (...args) => execFileSync("git", args, { cwd: NEXTJS_ROOT, encoding: "utf8" }).trim(),
};

const refusal = (code) => {
  if (typeof code !== "string" || !code) throw new Error("CENSUS_REFUSAL_WITHOUT_CODE");
  return `refused_typed:${code}`;
};
const errorCode = (error) => (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
  ? error.message : `untyped:${error instanceof Error ? error.name : typeof error}`);

/** What a manifest row says about a refused or absent extension, so the verdict is not one word for two situations. */
function notAccepted(deps, mime, code) {
  const live = deps.liveManifest.entries.some((entry) => entry.mime === mime);
  const declared = deps.declaredManifest.entries.some((entry) => entry.mime === mime);
  if (declared && !live) return { verdict: "declared_withheld", code };
  if (live) return { verdict: refusal(code), code };
  return { verdict: "absent", code: refusal(code).slice("refused_typed:".length) };
}

/** A validator that accepted: map the manifest row it landed on. */
function accepted(deps, stratum, mime) {
  const entry = deps.liveManifest.entries.find((row) => row.mime === mime);
  if (!entry) return { verdict: "not_computed:accepted_without_manifest_row" };
  if (entry.status !== "BEST_EFFORT") return { verdict: `not_computed:unmapped_status:${entry.status}` };
  if (stratum.tabular && !entry.preserved.includes("cells")) return { verdict: "accepted_structure_lost" };
  return { verdict: "accepted_best_effort" };
}

function uploadVerdict(deps, stratum, ext, mime, filename = `census-synthetic.${ext}`) {
  const decision = deps.validateInput({ originalFilename: filename, declaredMimeType: mime });
  return decision.valid ? accepted(deps, stratum, decision.normalizedMimeType) : notAccepted(deps, mime, decision.code);
}

/** Text facts about the source agent, read as text, never executed. */
function sourceAgentFacts(deps) {
  const text = deps.readText("public/developer/tavonel-source-agent.py");
  const block = /MIME_BY_SUFFIX = \{([^}]*)\}/.exec(text)?.[1] ?? "";
  const map = new Map([...block.matchAll(/"\.([a-z0-9]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const ceiling = /FOUNDATION_MAX_SOURCE_BYTES = (\d+) \* 1024 \* 1024/.exec(text)?.[1];
  return {
    map,
    unsupportedReason: text.includes('"unsupported_file_type"'),
    oversizedReason: text.includes('"exceeds_service_byte_ceiling_needs_review"'),
    ceilingBytes: ceiling ? Number(ceiling) * 1024 * 1024 : null,
  };
}

function zipOf(name, content) {
  return zipSync({ [name]: content });
}

async function archiveMemberVerdict(deps, stratum, ext, mime) {
  const name = `census-synthetic.${ext}`;
  const family = FAMILY(mime);
  const archive = new File([zipOf(name, family ? bytes(HEADERS[family]) : bytes(ascii("synthetic")))], "census-synthetic.zip");
  let selection;
  try {
    selection = await deps.prepareSelection([archive]);
  } catch (error) {
    return { verdict: `not_computed:archive_expansion_failed:${errorCode(error)}` };
  }
  const member = selection.files.find((file) => file.relativePath === name);
  if (!member) {
    return selection.unsupported.includes(name)
      ? notAccepted(deps, mime, "selection_unsupported")
      : { verdict: "not_computed:member_neither_staged_nor_skipped" };
  }
  // A staged member then goes to the same server gate as a direct upload, under the inferred type.
  return uploadVerdict(deps, stratum, ext, member.file.type, member.file.name);
}

/** The container itself: the manifest row decides the verdict; what expansion did is a separate field, not a verdict. */
async function archiveContainerVerdict(deps, stratum, ext, mime) {
  const name = `census-synthetic.${ext}`;
  const content = ext === "zip" ? zipOf("census-synthetic.pdf", bytes(HEADERS.pdf)) : bytes(ascii("synthetic"));
  let selection;
  try {
    selection = await deps.prepareSelection([new File([content], name)]);
  } catch (error) {
    return { verdict: `not_computed:container_expansion_failed:${errorCode(error)}` };
  }
  if (selection.unsupported.includes(name)) return notAccepted(deps, mime, "selection_unsupported");
  if (selection.files.length === 0) return { verdict: "not_computed:container_neither_expanded_nor_skipped" };
  return { ...accepted(deps, stratum, mime), expansion: `expanded:${selection.files.length}_member` };
}

/** Synthetic provider pages, one row per probe extension, served to the real list readers through an injected fetcher. */
const jsonResponse = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
const GOOGLE_PAGE = 25; // the reader refuses pages over 25 rows

function dropboxPage(probes) {
  return {
    entries: probes.map((p, i) => ({ ".tag": "file", id: `id:${i}`, name: p.name, path_lower: `/${p.name}`, rev: "a1c10ce0dd78", size: 1, server_modified: "2026-01-01T00:00:00Z" })),
    cursor: "census-cursor", has_more: false,
  };
}

function graphPage(probes) {
  return {
    value: probes.map((p, i) => ({ id: `g${i}`, name: p.name, eTag: "e1", size: 1, lastModifiedDateTime: "2026-01-01T00:00:00Z", file: { mimeType: p.mime } })),
    "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=census",
  };
}

function googleFetcher(probes) {
  return async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/changes/startPageToken")) return jsonResponse({ startPageToken: "census-start" });
    const from = Number(u.searchParams.get("pageToken") ?? 0);
    const rows = probes.slice(from, from + GOOGLE_PAGE).map((p, i) => ({ id: `f${from + i}`, name: p.name, mimeType: p.mime, version: "1", size: "1", modifiedTime: "2026-01-01T00:00:00Z" }));
    return jsonResponse({ files: rows, ...(from + GOOGLE_PAGE < probes.length ? { nextPageToken: String(from + GOOGLE_PAGE) } : {}) });
  };
}

/** name -> listed item as the real reader produced it, or { failed } when the reader itself failed. */
async function listedByProvider(deps, probes) {
  const byName = (items) => new Map(items.map((item) => [item.name, item]));
  const out = {};
  const attempt = async (provider, run) => {
    try { out[provider] = { items: byName(await run()) }; } catch (error) { out[provider] = { failed: errorCode(error) }; }
  };
  await attempt("dropbox", async () =>
    (await deps.listSource({ provider: "dropbox", accessToken: "synthetic", cursor: null, fetcher: async () => jsonResponse(dropboxPage(probes)) })).items);
  await attempt("microsoft_graph", async () =>
    (await deps.listSource({ provider: "microsoft_graph", accessToken: "synthetic", cursor: null, fetcher: async () => jsonResponse(graphPage(probes)) })).items);
  await attempt("google_drive", async () => {
    const fetcher = googleFetcher(probes);
    const items = [];
    let cursor = null;
    for (let guard = 0; guard < probes.length + 3 && items.length < probes.length; guard += 1) {
      const page = await deps.listGoogle({ accessToken: "synthetic", cursor, fetcher });
      items.push(...page.items);
      cursor = page.cursor;
    }
    return items;
  });
  return out;
}

/** One provider's verdict: the item the real list reader produced, through the real descriptor. */
function connectorVerdict(deps, stratum, ext, mime, listed) {
  if (listed.failed) return { verdict: `not_computed:connector_list_failed:${listed.failed}` };
  const item = listed.items.get(`census-synthetic.${ext}`);
  if (!item) return { verdict: "not_computed:probe_not_in_listed_page" };
  const descriptor = deps.describeImport(item);
  const note = { listedMimeType: item.mimeType };
  if (descriptor) return { ...accepted(deps, stratum, descriptor.mimeType), ...note };
  // The descriptor is null on every refusal; the code comes from the gate it called, on the MIME the listing carried.
  const decision = deps.validateInput({ originalFilename: item.name, declaredMimeType: item.mimeType ?? "" });
  return { ...(decision.valid ? { verdict: "not_computed:descriptor_null_but_gate_accepts" } : notAccepted(deps, mime, decision.code)), ...note };
}

function agentVerdict(deps, facts, stratum, ext) {
  if (facts.map.size === 0) return { verdict: "not_computed:agent_suffix_table_not_found_in_source" };
  const mime = facts.map.get(ext);
  if (!mime) {
    return facts.unsupportedReason
      ? { verdict: refusal("unsupported_file_type"), code: "unsupported_file_type" }
      : { verdict: "not_computed:agent_refusal_reason_not_found_in_source" };
  }
  const result = uploadVerdict(deps, stratum, ext, mime);
  return { ...result, note: `agent offers it as ${mime}; verdict is what the upload gate then does` };
}

/** Conditions for the upload path: each fed to the real function that owns the check. */
function uploadConditions(deps, stratum, ext, mime) {
  const family = FAMILY(mime);
  const out = {};
  const run = (name, via, fn) => { out[name] = { via, ...fn() }; };
  const baseline = deps.verifySignature(mime, bytes(HEADERS[family]));
  if (!baseline.ok) throw new Error(`CENSUS_FIXTURE_BASELINE_REFUSED:${ext}:${baseline.code}`);
  const sig = (fixture, bytesIn) => {
    const verdict = deps.verifySignature(mime, bytesIn);
    return { fixture, outcome: verdict.ok ? "not_refused_at_intake" : refusal(verdict.code) };
  };
  run("mime_mismatch", "validateQualifiedDocumentInput", () => {
    const wrong = ext === "pdf" ? "png" : "pdf";
    const decision = deps.validateInput({ originalFilename: `census-synthetic.${wrong}`, declaredMimeType: mime });
    return { fixture: `name .${wrong} with declared ${mime}`, outcome: decision.valid ? "not_refused_at_intake" : refusal(decision.code) };
  });
  run("bad_magic_unrecognised", "verifySourceSignature", () => sig("html text where the signature belongs", bytes(ascii("<html>synthetic"))));
  run("bad_magic_wrong_family", "verifySourceSignature", () =>
    sig("a PNG header declared as a different family", bytes(family === "png" ? HEADERS.pdf : HEADERS.png, ascii("x"))));
  run("truncated_header", "verifySourceSignature", () => sig("first 2 bytes of the signature only", bytes(HEADERS[family].slice(0, 2))));
  run("malformed_body", "verifySourceSignature", () => sig("valid header, then 64 bytes of 0xff", bytes(HEADERS[family], new Array(64).fill(0xff))));
  run("encrypted", "verifySourceSignature", () => {
    if (family === "pdf") return sig("PDF header with an /Encrypt dictionary", bytes(HEADERS.pdf, ascii("1 0 obj<</Filter/Standard/Encrypt 2 0 R>>endobj")));
    if (mime.startsWith(OOXML)) return sig("OLE compound file, the wrapper of a password-protected OOXML file", bytes(OLE, new Array(32).fill(0)));
    if (family === "zip") return sig("zip header with an encryption marker in the body", bytes(HEADERS.zip, ascii("META-INF/manifest.xml encryption-data")));
    return { fixture: null, outcome: "not_run:no_encrypted_form_defined_for_this_format" };
  });
  run("over_pages", "quoteIntakeFile", () => {
    const claimedBasis = { pdf: "pdf_page_tree", jpeg: "image", png: "image", tiff: "image", gif: "image" }[family]
      ?? (mime.endsWith("presentation") && mime.startsWith(OOXML) ? "pptx_slides" : mime.endsWith("document") && mime.startsWith(OOXML) ? "docx_declared" : null);
    const quoted = deps.quoteFile({ bytes: 1024, mimeType: mime, claimedPages: PROCESSING_CEILING.maxSourcePages + 1, claimedBasis });
    return {
      fixture: `claims ${PROCESSING_CEILING.maxSourcePages + 1} pages, basis ${claimedBasis}`,
      outcome: quoted.ok ? "not_refused_at_intake" : refusal(quoted.code),
    };
  });
  run("over_bytes", "route_source_text", () => {
    const text = deps.readText("app/api/v1/uploads/quote/route.ts");
    const inline = /entry\.byteLength > FOUNDATION_INTAKE_MAX_BYTES/.test(text) && text.includes("SOURCE_EXCEEDS_PROCESSING_CEILING");
    return {
      fixture: null, ceilingBytes: PROCESSING_CEILING.maxSourceBytes,
      outcome: inline ? "not_run:byte_check_is_inline_in_the_route_no_callable_function" : "not_computed:byte_check_not_found_in_route_source",
    };
  });
  return out;
}

/** Archive-container conditions, each through expandArchive / inspectCentralDirectory / prepareWorkspaceSelection. */
async function archiveConditions(deps) {
  const pdf = bytes(HEADERS.pdf);
  const encrypted = zipOf("a.pdf", pdf);
  const view = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
  for (let i = 0; i <= encrypted.length - 4; i += 1) {
    if (view.getUint32(i, true) === 0x02014b50) { view.setUint16(i + 8, view.getUint16(i + 8, true) | 1, true); break; }
  }
  const many = zipSync(Object.fromEntries(Array.from({ length: MAX_FILES + 1 }, (_, i) => [`m${i}.pdf`, pdf])));
  const cases = {
    baseline_expands: { via: "expandArchive", fixture: "one PDF member", bytes: zipOf("a.pdf", pdf) },
    encrypted: { via: "expandArchive", fixture: "general-purpose flag bit 0 set in the central directory", bytes: encrypted },
    malformed_truncated: { via: "expandArchive", fixture: "archive cut 10 bytes short of the end record", bytes: zipOf("a.pdf", pdf).slice(0, -10) },
    malformed_not_a_zip: { via: "expandArchive", fixture: "64 bytes of 0xff", bytes: new Uint8Array(64).fill(0xff) },
    path_traversal: { via: "expandArchive", fixture: "member ../evil.pdf", bytes: zipOf("../evil.pdf", pdf) },
    nested_archive: { via: "expandArchive", fixture: "member inner.zip", bytes: zipOf("inner.zip", pdf) },
    decompression_bomb: { via: "expandArchive", fixture: "one 11 MiB member of zeros", bytes: zipOf("a.pdf", new Uint8Array(11 * 1024 * 1024)) },
    too_many_files: { via: "expandArchive", fixture: `${MAX_FILES + 1} members`, bytes: many },
  };
  const out = {};
  for (const [name, spec] of Object.entries(cases)) {
    try {
      const entries = deps.expand(spec.bytes);
      out[name] = { via: spec.via, fixture: spec.fixture, outcome: name === "baseline_expands" ? `expanded:${entries.length}_member` : "not_refused_at_expansion" };
    } catch (error) {
      out[name] = { via: spec.via, fixture: spec.fixture, outcome: refusal(errorCode(error)) };
    }
  }
  try {
    await deps.prepareSelection([new File([new Uint8Array(MAX_SYNC_ARCHIVE_BYTES + 1)], "census-synthetic.zip")]);
    out.over_size_archive = { via: "prepareWorkspaceSelection", fixture: `${MAX_SYNC_ARCHIVE_BYTES + 1} byte .zip, no worker`, outcome: "not_refused_at_selection" };
  } catch (error) {
    out.over_size_archive = { via: "prepareWorkspaceSelection", fixture: `${MAX_SYNC_ARCHIVE_BYTES + 1} byte .zip, no worker`, outcome: refusal(errorCode(error)) };
  }
  return out;
}

export async function computeCensus(deps = realDeps) {
  let sha;
  let dirty;
  try {
    sha = deps.git("rev-parse", "HEAD");
    dirty = deps.git("status", "--porcelain").length > 0;
  } catch {
    sha = "not_computed:git_unavailable";
    dirty = null;
  }
  const agent = sourceAgentFacts(deps);
  const strata = [];
  const seen = new Map();
  for (const stratum of STRATA) for (const { ext, mime } of stratum.exts) seen.set(ext, { name: `census-synthetic.${ext}`, mime });
  const listed = await listedByProvider(deps, [...seen.values()]);
  for (const stratum of STRATA) {
    const rows = [];
    for (const { ext, mime } of stratum.exts) {
      const archive = stratum.id === 15 ? await archiveContainerVerdict(deps, stratum, ext, mime) : await archiveMemberVerdict(deps, stratum, ext, mime);
      const upload = uploadVerdict(deps, stratum, ext, mime);
      rows.push({
        ext, probeMime: mime,
        paths: {
          upload, archive, source_agent: agentVerdict(deps, agent, stratum, ext),
          connector_dropbox: connectorVerdict(deps, stratum, ext, mime, listed.dropbox),
          connector_microsoft_graph: connectorVerdict(deps, stratum, ext, mime, listed.microsoft_graph),
          connector_google_drive: connectorVerdict(deps, stratum, ext, mime, listed.google_drive),
        },
        conditions: upload.verdict.startsWith("accepted") ? { upload: uploadConditions(deps, stratum, ext, mime) } : null,
      });
    }
    strata.push({ id: stratum.id, name: stratum.name, rows });
  }
  let googleReader;
  try {
    await deps.listSource({ provider: "google_drive", accessToken: "synthetic", cursor: null, fetcher: () => { throw new Error("no network in the census"); } });
    googleReader = "not_refused";
  } catch (error) {
    googleReader = refusal(errorCode(error));
  }
  const nativeExports = Object.fromEntries(
    ["document", "spreadsheet", "presentation", "drawing", "form"].map((kind) => {
      const mime = `application/vnd.google-apps.${kind}`;
      const d = deps.describeImport({ nativeId: "synthetic", name: "census-synthetic", revision: "synthetic", mimeType: mime, sizeBytes: 1, modifiedAt: null, kind: "file" });
      return [mime, d ? `exported_as:${d.mimeType}` : "refused_by_descriptor"];
    }),
  );
  const summary = Object.fromEntries(PATHS.map((p) => {
    const counts = {};
    let total = 0;
    for (const stratum of strata) for (const row of stratum.rows) { counts[row.paths[p].verdict] = (counts[row.paths[p].verdict] ?? 0) + 1; total += 1; }
    return [p, { denominator_extension_probes: total, counts }];
  }));
  return {
    schema: CENSUS_SCHEMA,
    foundationSha: sha,
    worktreeDirty: dirty,
    ceilings: {
      intakeMaxSourceBytes: PROCESSING_CEILING.maxSourceBytes, intakeMaxSourcePages: PROCESSING_CEILING.maxSourcePages,
      sourceAgentMaxSourceBytes: agent.ceilingBytes, sourceAgentCeilingMatches: agent.ceilingBytes === PROCESSING_CEILING.maxSourceBytes,
      sourceAgentOversizedReasonPresent: agent.oversizedReason,
    },
    textInputsLive: TEXT_INPUTS_LIVE,
    strata,
    archiveConditions: await archiveConditions(deps),
    connector: { googleDriveListReader: googleReader, googleNativeExports: nativeExports },
    summary,
    notRun: [
      "gmail adapter: not examined (metadata-only per CIP; no entry-path function was called)",
      "byte ceiling: inline in the quote route, not callable (see over_bytes rows)",
      "provider list pages are synthetic, in each provider's documented response shape, served to the real list readers through an injected fetcher; Dropbox lists no MIME, Graph and Google list the probe MIME, which a real provider may report differently",
      "stratum 1 and 2 share one extension: intake cannot tell a text PDF from a scan, so both rows are the same call",
      "probe MIME types are plausible browser values, not measured ones; a client that declares another MIME for the same extension is a different input",
    ],
  };
}

/** One line per (stratum, ext): the part of the census a snapshot pins. */
export function matrixLines(census) {
  return census.strata.flatMap((s) => s.rows.map((r) =>
    `${s.id}/${s.name}/${r.ext} ${PATHS.map((p) => `${p}=${r.paths[p].verdict}`).join(" ")}`));
}

/** One line per condition outcome, pinned for the same reason. */
export function conditionLines(census) {
  const lines = census.strata.flatMap((s) => s.rows.flatMap((r) => Object.entries(r.conditions?.upload ?? {})
    .map(([name, c]) => `${s.id}/${r.ext}/${name} ${c.outcome}`)));
  return [...lines, ...Object.entries(census.archiveConditions).map(([name, c]) => `archive/${name} ${c.outcome}`)];
}

export function renderMarkdown(census) {
  const out = [`# Foundation entry-path census (${census.schema})`, "",
    `Foundation SHA: \`${census.foundationSha}\` (worktree dirty: ${census.worktreeDirty}). Synthetic fixtures only. Internal receipt, not public copy.`, "",
    "## Verdicts per stratum, extension and entry path", "",
    `| # | stratum | ext | probe MIME | ${PATHS.join(" | ")} |`, `|---|---|---|---|${PATHS.map(() => "---").join("|")}|`];
  for (const s of census.strata) for (const r of s.rows) {
    out.push(`| ${s.id} | ${s.name} | ${r.ext} | ${r.probeMime} | ${PATHS.map((p) => `\`${r.paths[p].verdict}\``).join(" | ")} |`);
  }
  out.push("", "## Denominators (extension probes per path)", "");
  for (const p of PATHS) out.push(`- ${p}: ${census.summary[p].denominator_extension_probes} probes — ${Object.entries(census.summary[p].counts).map(([k, n]) => `${k}: ${n}`).join("; ")}`);
  out.push("", "## Upload-path conditions for accepted extensions", "", "| ext | condition | via | outcome |", "|---|---|---|---|");
  for (const s of census.strata) for (const r of s.rows) for (const [name, c] of Object.entries(r.conditions?.upload ?? {})) {
    out.push(`| ${r.ext} | ${name} | ${c.via} | \`${c.outcome}\` |`);
  }
  out.push("", "## Archive container conditions", "", "| condition | via | fixture | outcome |", "|---|---|---|---|");
  for (const [name, c] of Object.entries(census.archiveConditions)) out.push(`| ${name} | ${c.via} | ${c.fixture} | \`${c.outcome}\` |`);
  out.push("", "## Connector", "", `- google_drive list reader: \`${census.connector.googleDriveListReader}\``);
  for (const [mime, v] of Object.entries(census.connector.googleNativeExports)) out.push(`- ${mime}: \`${v}\``);
  out.push("", "## Not run", "", ...census.notRun.map((line) => `- ${line}`), "");
  return out.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf("--out");
  if (at < 0 || !process.argv[at + 1]) throw new Error("usage: format-census.mjs --out <dir>");
  const census = await computeCensus();
  const dir = process.argv[at + 1];
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "census.json"), `${JSON.stringify(census, null, 2)}\n`);
  writeFileSync(path.join(dir, "census.md"), renderMarkdown(census));
  console.log(`wrote ${dir}/census.json and census.md`);
}
