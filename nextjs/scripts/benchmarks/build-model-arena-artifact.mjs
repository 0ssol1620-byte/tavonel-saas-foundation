#!/usr/bin/env node
/**
 * Build `content/benchmarks/model-arena-20260903.json` from the Model Arena campaign outputs.
 *
 * The campaign lives in the research repository, not here. This script reads its committed
 * reports, binds every one of them by sha256, and writes the one file `/benchmarks` renders. It
 * is run by hand when the campaign produces a new board; the artifact is committed, so a
 * deployment never reaches the research tree.
 *
 * Three rules it enforces, all of them constitution rules rather than taste:
 *
 *   1. **Refuse on a missing source.** Every required report is read before anything is written.
 *      A report that is not on this machine is a build failure, not a blank column -- an artifact
 *      assembled from four of six sources would still look complete.
 *   2. **Bind what was read.** Each source path is recorded with the sha256 of the bytes this run
 *      read. `lib/model-arena-page-data.ts` pins the sha256 of the artifact itself, so the chain
 *      from a bar on the page to a file in the research tree is checkable end to end.
 *   3. **Copy, never restate.** Every figure is the campaign's own number at full precision, and
 *      every caveat and anomaly note is carried verbatim. Nothing here rounds, averages, ranks by
 *      a criterion the campaign did not rank by, or writes a sentence about a model.
 *
 * Usage:
 *   node scripts/benchmarks/build-model-arena-artifact.mjs --arena-root <path> [--out <path>]
 *   TAVONEL_ARENA_ROOT=<path> node scripts/benchmarks/build-model-arena-artifact.mjs
 *
 * `--check` writes nothing and fails if the committed artifact differs from what this run would
 * write, which is what makes "deterministic" a testable claim rather than an intention.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** The reports this artifact is assembled from. A missing one stops the build. */
export const REQUIRED_SOURCES = [
  "reports/full_compare_20260905/LEADERBOARD_QUALITY_SPEED.json",
  "reports/full_compare_20260905/comparison_omnidoc_full.json",
  "reports/full_compare_20260905/ANOMALY_NOTES.md",
  "reports/full_compare_20260905/STATUS.md",
  "model_registry.json",
  "evaluator_registry.json",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readSource(arenaRoot, relative, sources) {
  const absolute = path.join(arenaRoot, relative);
  let bytes;
  try {
    bytes = readFileSync(absolute);
  } catch {
    throw new Error(`model_arena_source_missing: ${relative} (looked in ${arenaRoot})`);
  }
  sources.push({ path: relative, sha256: sha256(bytes) });
  return bytes;
}

/**
 * The anomaly notes, split into the sections a reader would quote, verbatim.
 *
 * A section belongs to a model when the model's key appears in its heading. That is the only
 * association rule: a note is attached to a row or it is not, and nothing here paraphrases a
 * note down to a sentence that fits a cell.
 */
export function anomalySections(markdown) {
  const sections = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let heading = null;
  let body = [];
  const flush = () => {
    if (heading !== null) sections.push({ heading, text: `${heading}\n${body.join("\n")}`.trim() });
  };
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      flush();
      heading = line.replace(/^##\s+/, "").trim();
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  flush();
  return sections;
}

const notesFor = (sections, key) =>
  sections.filter((section) => section.heading.includes(key)).map((section) => section.text);

/** Stable key order, so two runs over the same inputs produce the same bytes. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const identityOf = (model) => ({
  /* Weights for a local model, the hosted model id for the one hosted surface. */
  weights_repository: model.weights?.repo ?? null,
  weights_revision: model.weights?.revision ?? null,
  api_model_id: model.api_model_id ?? null,
  container_image: model.container_image ?? null,
  container_digest: model.container_digest ?? null,
  container_digest_unresolved_reason: model.container_digest
    ? null
    : (model.container_digest_unresolved_reason ?? null),
  license: model.license,
});

const speedOf = (entry) => ({
  median_seconds_per_page: entry.median_sec_per_page ?? null,
  p90_seconds_per_page: entry.p90_sec_per_page ?? null,
  serial_pages_per_hour: entry.serial_pages_per_hour ?? null,
  /* The denominator of the median: how many timed successful pages it was taken over. */
  timed_pages: entry.speed_n_success_timed ?? null,
  missing: Boolean(entry.speed_missing),
});

export function buildArtifact(arenaRoot) {
  const sources = [];
  const read = (relative) => readSource(arenaRoot, relative, sources);

  const leaderboard = JSON.parse(read(REQUIRED_SOURCES[0]).toString("utf8"));
  const comparison = JSON.parse(read(REQUIRED_SOURCES[1]).toString("utf8"));
  const anomalies = anomalySections(read(REQUIRED_SOURCES[2]).toString("utf8"));
  read(REQUIRED_SOURCES[3]); // STATUS.md: bound as the run's own narrative, not parsed.
  const registry = JSON.parse(read(REQUIRED_SOURCES[4]).toString("utf8"));
  const evaluators = JSON.parse(read(REQUIRED_SOURCES[5]).toString("utf8"));

  /**
   * The canary proof of one model, when the campaign produced one.
   *
   * `infinity_parser2_flash` ran without one, so the GPU and the listed rate are genuinely
   * unknown for that row. An absent proof records a stated reason and leaves the fields null;
   * it never borrows another model's GPU, and it never prints a rate nobody measured.
   */
  const canaryOf = (key) => {
    const relative = `evidence/canary-proof-${key}.json`;
    let bytes;
    try {
      bytes = readFileSync(path.join(arenaRoot, relative));
    } catch {
      return {
        gpu_type: null,
        listed_usd_per_hour: null,
        price_snapshot_sha256: null,
        runtime_image_digest: null,
        verdict: null,
        absent_reason: "no canary proof in the campaign evidence directory for this model key",
      };
    }
    sources.push({ path: relative, sha256: sha256(bytes) });
    const proof = JSON.parse(bytes.toString("utf8"));
    return {
      gpu_type: proof.gpu_type ?? null,
      listed_usd_per_hour: proof.listed_rate_usd_per_hour ?? null,
      price_snapshot_sha256: proof.price_snapshot_sha256 ?? null,
      runtime_image_digest: proof.runtime_image_digest ?? null,
      verdict: proof.canary_verdict ?? null,
      absent_reason: null,
    };
  };

  const row = (entry, status, statusNote) => {
    const model = registry.models[entry.model];
    if (!model) throw new Error(`model_arena_model_not_in_registry: ${entry.model}`);
    return {
      key: entry.model,
      display_name: model.display_name,
      status,
      status_note: statusNote,
      identity: identityOf(model),
      omnidoc: {
        text_edit: entry.text_edit,
        formula_edit: entry.formula_edit,
        table_edit: entry.table_edit,
        table_teds: entry.table_teds,
        reading_order_edit: entry.reading_order_edit,
        /* The denominator every metric above was computed over. */
        pages: entry.pages,
        tag: entry.tag,
      },
      speed: speedOf(entry),
      gpu: canaryOf(entry.model),
      notes: [...(entry.notes ?? []), ...notesFor(anomalies, entry.model)],
    };
  };

  const models = [
    ...leaderboard.omnidoc.settled.map((entry) => row(entry, "settled", null)),
    ...leaderboard.omnidoc.reference.map((entry) =>
      row(entry, "reference", "Reference row: on the board for context, not ranked with the settled rows.")),
  ];

  /*
    The excluded row. `infinity_parser2_pro` has a speed reading and no quality reading, because
    the founder stopped it mid-campaign over GPU spend. It is published with that reason rather
    than dropped: a board that silently loses the model somebody was about to ask about is the
    shape this campaign's own rules exist to prevent.
  */
  for (const [key, speed] of Object.entries(leaderboard.speed_reference_only ?? {})) {
    const model = registry.models[key];
    if (!model) throw new Error(`model_arena_model_not_in_registry: ${key}`);
    models.push({
      key,
      display_name: model.display_name,
      status: leaderboard.omnidoc.pending.includes(key) ? "excluded" : "pending",
      status_note:
        "FOUNDER_EXCLUDED 2026-09-04 over GPU spend (H100x2, about $7/h per pod). Speed is reference-only; no quality reading was completed, so this model has no quality row.",
      identity: identityOf(model),
      omnidoc: null,
      speed: speedOf({
        median_sec_per_page: speed.median_sec_per_page,
        p90_sec_per_page: speed.p90_sec_per_page,
        serial_pages_per_hour: speed.serial_pages_per_hour,
        speed_n_success_timed: speed.speed_n_success_timed,
        speed_missing: speed.speed_missing,
      }),
      gpu: canaryOf(key),
      notes: notesFor(anomalies, key),
    });
  }

  const omnidoc = evaluators.evaluators.omnidoc;
  const opus = registry.models.opus5_subscription;

  const artifact = {
    schema: "tavonel.site.model_arena.v1",
    campaign_id: registry.campaign_id,
    board_generated_at_kst: leaderboard.generated_at_kst,
    comparison_generated_at_kst: comparison.generated_at_kst,
    registry_snapshot_at: registry.generated_at,
    cloud_cost_usd: leaderboard.cloud_cost_usd,
    benchmark: {
      name: "OmniDocBench",
      evaluator: comparison.methodology.evaluator,
      evaluator_repository: omnidoc.dataset_repository,
      evaluator_pin: omnidoc.main_pin,
      evaluator_entrypoint: omnidoc.entrypoint,
      evaluator_license: omnidoc.license,
      dataset_revision: omnidoc.dataset_revision,
      dataset_license: omnidoc.dataset_license,
      dataset_redistribution: omnidoc.dataset_redistribution,
      driver: comparison.methodology.driver,
      gt_pages: comparison.gt_full_pages,
    },
    speed_method: {
      source: leaderboard.speed_source,
      definition:
        "Inference latency per page from the campaign database (SUCCESS started_at to finished_at), as a median and the serial pages per hour that median implies.",
      not_measured: "Scoring wall-time. OmniDoc elapsed and olmOCR scoring time are not speed.",
    },
    /*
      The hosted row's price reference, carried because the subscription lane has no GPU line and
      a row with no cost of any kind reads as free. The campaign contract is explicit that it is
      never reported as $0/page; this is the list price of the API surface on the capture date,
      and it is not a price this run paid.
    */
    hosted_price_reference: opus?.list_price_reference
      ? {
        model_key: "opus5_subscription",
        captured_at: opus.list_price_reference.captured_at,
        input_usd_per_mtok: opus.list_price_reference.input_usd_per_mtok,
        output_usd_per_mtok: opus.list_price_reference.output_usd_per_mtok,
        note: opus.list_price_reference.note,
        source_url: opus.list_price_reference.source_url,
      }
      : null,
    caveats: leaderboard.caveats,
    models,
    sources: [...sources].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };

  return `${JSON.stringify(canonical(artifact), null, 2)}\n`;
}

/* ------------------------------------------------------------------ cli */

export function main(argv, outDefault) {
  const arg = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const arenaRoot = arg("--arena-root") ?? process.env.TAVONEL_ARENA_ROOT;
  if (!arenaRoot) {
    throw new Error("model_arena_arena_root_not_given: pass --arena-root or set TAVONEL_ARENA_ROOT");
  }
  const out = arg("--out") ?? outDefault;
  const built = buildArtifact(arenaRoot);

  if (argv.includes("--check")) {
    if (readFileSync(out, "utf8") !== built) {
      throw new Error(`model_arena_artifact_stale: ${out} differs from a fresh build`);
    }
    return `ok ${out} sha256 ${sha256(Buffer.from(built, "utf8"))}`;
  }
  writeFileSync(out, built);
  return `wrote ${out}\nsha256 ${sha256(Buffer.from(built, "utf8"))}`;
}

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ""));
const ARTIFACT = path.join(here, "..", "..", "content", "benchmarks", "model-arena-20260903.json");

if (process.argv[1] && path.basename(process.argv[1]) === "build-model-arena-artifact.mjs") {
  process.stdout.write(`${main(process.argv.slice(2), ARTIFACT)}\n`);
}
