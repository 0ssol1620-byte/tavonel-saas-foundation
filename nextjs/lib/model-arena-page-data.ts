/**
 * The committed Model Arena board, and the rules that decide whether it may be rendered.
 *
 * `content/benchmarks/model-arena-20260903.json` is written by
 * `scripts/benchmarks/build-model-arena-artifact.mjs` from the campaign's own reports in the
 * research repository. It is not edited here: the page reads it, this module validates it, and
 * `model-arena-page-data.test.ts` recomputes its sha256 against `MODEL_ARENA_ARTIFACT_SHA256`,
 * so a silently swapped artifact fails the suite rather than the reader.
 *
 * What this file exists to prevent, in the order a reader would notice it:
 *
 *   1. **A rate or a median without its denominator.** Every quality row carries the page count
 *      it was scored over, and every speed row that carries a median carries the number of timed
 *      pages the median was taken over. A row with a figure and no population is refused.
 *   2. **A number the artifact does not contain.** There is no default, no interpolation and no
 *      fallback row. `arenaModel()` throws on a key the artifact does not carry rather than
 *      returning an empty shape that renders as a zero-length bar.
 *   3. **A rank the campaign did not make.** The settled order is the artifact's order, which is
 *      the campaign's own ranking by text Edit. Nothing here re-sorts a board by a metric the
 *      campaign did not rank by, and the reference, excluded and pending rows are never mixed
 *      into the settled ranking.
 *
 * Validation is fail-closed: `modelArenaBoard()` throws on the first invalid artifact, which
 * turns a bad swap into a build failure. It does not fall back to a previous board and it does
 * not render a partial one.
 *
 * One word does not appear on this page or in this module, deliberately. An Edit distance and a
 * TEDS score are structural similarity measures against one benchmark's ground truth on 1,651
 * pages of that benchmark's corpus; calling either "accuracy" would state a property of reading
 * documents in general that no row here measured. `benchmarks-page.test.ts` fails the build if
 * the rendered page contains it.
 */

import artifact from "../content/benchmarks/model-arena-20260903.json";

/**
 * The sha256 of `content/benchmarks/model-arena-20260903.json` as committed, LF-normalised
 * (`.gitattributes` pins `eol=lf` so the working tree, the commit and CI hash the same bytes).
 *
 * Replacing the artifact means replacing this line in the same commit. The test prints the value
 * it computed, so a stale digest names its own fix.
 */
export const MODEL_ARENA_ARTIFACT_SHA256 =
  "62c1a9ac04f88696438de6bf96c965d11c64dc843a1fc790767e85e6fdb2760f" as const;

export const MODEL_ARENA_ARTIFACT_PATH =
  "nextjs/content/benchmarks/model-arena-20260903.json" as const;

/* ------------------------------------------------------------------ shape */

/**
 * What the campaign says about a row's standing, in its own vocabulary.
 *
 * `settled` is a completed reading on the full ground truth. `reference` is a reading the
 * campaign kept on the board for context and refused to rank. `excluded` is a model the founder
 * stopped mid-campaign. `pending` is a reading that was never completed. A status is never
 * inferred from whether a figure exists.
 */
export const ARENA_STATUSES = ["settled", "reference", "excluded", "pending"] as const;
export type ArenaStatus = (typeof ARENA_STATUSES)[number];

export type ArenaOmniDoc = Readonly<{
  text_edit: number;
  formula_edit: number;
  table_edit: number;
  table_teds: number;
  reading_order_edit: number;
  /** The denominator: how many ground-truth pages every figure above was scored over. */
  pages: number;
  tag: string;
}>;

export type ArenaSpeed = Readonly<{
  median_seconds_per_page: number | null;
  p90_seconds_per_page: number | null;
  serial_pages_per_hour: number | null;
  /** The denominator of the median: how many timed successful pages it was taken over. */
  timed_pages: number | null;
  missing: boolean;
}>;

export type ArenaModel = Readonly<{
  key: string;
  display_name: string;
  status: ArenaStatus;
  status_note: string | null;
  identity: Readonly<{
    weights_repository: string | null;
    weights_revision: string | null;
    api_model_id: string | null;
    container_image: string | null;
    container_digest: string | null;
    container_digest_unresolved_reason: string | null;
    license: string;
  }>;
  omnidoc: ArenaOmniDoc | null;
  speed: ArenaSpeed;
  gpu: Readonly<{
    gpu_type: string | null;
    listed_usd_per_hour: number | null;
    price_snapshot_sha256: string | null;
    runtime_image_digest: string | null;
    verdict: string | null;
    absent_reason: string | null;
  }>;
  notes: readonly string[];
}>;

export type ArenaBoard = Readonly<{
  schema: string;
  campaign_id: string;
  board_generated_at_kst: string;
  comparison_generated_at_kst: string;
  registry_snapshot_at: string;
  cloud_cost_usd: number;
  benchmark: Readonly<{
    name: string;
    evaluator: string;
    evaluator_repository: string;
    evaluator_pin: string;
    evaluator_entrypoint: string;
    evaluator_license: string;
    dataset_revision: string;
    dataset_license: string;
    dataset_redistribution: string;
    driver: string;
    gt_pages: number;
  }>;
  speed_method: Readonly<{ source: string; definition: string; not_measured: string }>;
  hosted_price_reference: Readonly<{
    model_key: string;
    captured_at: string;
    input_usd_per_mtok: number;
    output_usd_per_mtok: number;
    note: string;
    source_url: string;
  }> | null;
  caveats: readonly string[];
  models: readonly ArenaModel[];
  sources: readonly Readonly<{ path: string; sha256: string }>[];
}>;

/* ------------------------------------------------------------------ validation */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isCount = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value) && value > 0;

/** The five OmniDoc figures, and the range each one is defined on. All are 0..1. */
const OMNIDOC_FIELDS = [
  "text_edit",
  "formula_edit",
  "table_edit",
  "table_teds",
  "reading_order_edit",
] as const;

/**
 * Every refusal this module knows how to state, as a list rather than a throw, so the test can
 * assert on the message and the caller can decide what a failure means.
 */
export function validateArenaArtifact(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ["artifact: expected an object"];

  if (value.schema !== "tavonel.site.model_arena.v1") {
    problems.push(`artifact.schema: unexpected schema ${String(value.schema)}`);
  }

  const sources = value.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    problems.push("artifact.sources: no source is bound");
  } else {
    for (const source of sources) {
      if (!isRecord(source) || typeof source.path !== "string" || !source.path) {
        problems.push("artifact.sources: a source has no path");
        continue;
      }
      if (typeof source.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(source.sha256)) {
        problems.push(`artifact.sources.${source.path}: not bound by a sha256`);
      }
    }
  }

  const models = value.models;
  if (!Array.isArray(models) || models.length === 0) {
    problems.push("artifact.models: no model rows");
    return problems;
  }

  const seen = new Set<string>();
  for (const model of models) {
    if (!isRecord(model) || typeof model.key !== "string" || !model.key) {
      problems.push("artifact.models: a row has no model key");
      continue;
    }
    const where = `artifact.models.${model.key}`;
    if (seen.has(model.key)) problems.push(`${where}: duplicate model key`);
    seen.add(model.key);

    if (!ARENA_STATUSES.includes(model.status as ArenaStatus)) {
      problems.push(`${where}.status: unknown status ${String(model.status)}`);
    }

    if (model.omnidoc !== null) {
      if (!isRecord(model.omnidoc)) {
        problems.push(`${where}.omnidoc: expected a reading or null`);
      } else {
        if (!isCount(model.omnidoc.pages)) {
          problems.push(`${where}.omnidoc: missing denominator (pages)`);
        }
        for (const field of OMNIDOC_FIELDS) {
          const figure = model.omnidoc[field];
          if (!isFiniteNumber(figure)) {
            problems.push(`${where}.omnidoc.${field}: missing figure`);
            continue;
          }
          if (figure < 0) problems.push(`${where}.omnidoc.${field}: negative figure`);
          else if (figure > 1) problems.push(`${where}.omnidoc.${field}: figure outside 0..1`);
        }
      }
    }

    const speed = model.speed;
    if (!isRecord(speed)) {
      problems.push(`${where}.speed: expected a speed record`);
      continue;
    }
    for (const field of ["median_seconds_per_page", "p90_seconds_per_page", "serial_pages_per_hour"] as const) {
      const figure = speed[field];
      if (figure === null) continue;
      if (!isFiniteNumber(figure)) problems.push(`${where}.speed.${field}: not a number`);
      else if (figure <= 0) problems.push(`${where}.speed.${field}: not a positive rate`);
    }
    if (speed.median_seconds_per_page !== null && !isCount(speed.timed_pages)) {
      problems.push(`${where}.speed: median without a denominator (timed_pages)`);
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ reading */

let board: ArenaBoard | null = null;

/** The validated board. Throws on the first invalid artifact; never renders a partial one. */
export function modelArenaBoard(): ArenaBoard {
  if (board) return board;
  const problems = validateArenaArtifact(artifact);
  if (problems.length > 0) {
    throw new Error(`model_arena_artifact_invalid: ${problems.join("; ")}`);
  }
  board = artifact as unknown as ArenaBoard;
  return board;
}

/** One row by key. Throws on a key the artifact does not carry, rather than returning a blank. */
export function arenaModel(key: string): ArenaModel {
  const found = modelArenaBoard().models.find((model) => model.key === key);
  if (!found) throw new Error(`model_arena_unknown_model: ${key}`);
  return found;
}

/** The rows the campaign settled, in the campaign's own order. Never re-sorted here. */
export const settledModels = (): readonly ArenaModel[] =>
  modelArenaBoard().models.filter((model) => model.status === "settled");

/** Everything the campaign did not settle, with the reason it did not, in artifact order. */
export const unsettledModels = (): readonly ArenaModel[] =>
  modelArenaBoard().models.filter((model) => model.status !== "settled");

/* ------------------------------------------------------------------ chart geometry */

export type ArenaBar = Readonly<{
  key: string;
  label: string;
  status: ArenaStatus;
  value: number;
  /** The figure's share of the chart's own maximum, 0..1. The only derived number on the page. */
  fraction: number;
  pages: number;
}>;

/**
 * Bars for one OmniDoc figure, scaled against the largest value among the bars themselves.
 *
 * The scale is the chart's own maximum rather than 1.0, because every text Edit on this board is
 * under 0.18 and a 0..1 axis would draw ten bars of identical apparent length. The axis label on
 * the page states the maximum, so the reader is told what the longest bar is.
 *
 * Direction is not encoded here. Edit is lower-better and TEDS is higher-better, and a chart
 * that silently inverted one of them would make the better model look worse; the page prints the
 * direction beside the axis and the bars stay proportional to the figures.
 */
export function arenaBars(
  metric: "text_edit" | "table_teds" | "table_edit" | "formula_edit" | "reading_order_edit",
  rows: readonly ArenaModel[] = settledModels(),
): readonly ArenaBar[] {
  const scored = rows.filter((model) => model.omnidoc !== null);
  const max = Math.max(...scored.map((model) => model.omnidoc![metric]));
  if (!isFiniteNumber(max) || max <= 0) throw new Error(`model_arena_chart_has_no_scale: ${metric}`);
  return scored.map((model) => ({
    key: model.key,
    label: model.display_name,
    status: model.status,
    value: model.omnidoc![metric],
    fraction: model.omnidoc![metric] / max,
    pages: model.omnidoc!.pages,
  }));
}

export type ArenaDot = Readonly<{
  key: string;
  label: string;
  status: ArenaStatus;
  secondsPerPage: number;
  pagesPerHour: number;
  textEdit: number;
  pages: number;
  timedPages: number;
}>;

/**
 * The speed-against-quality plot: only the rows that have both readings.
 *
 * A model missing from the speed board is not plotted at a guessed position and not plotted at
 * zero. It is listed under the plot with the reason its speed is absent, which is the campaign's
 * own caveat rather than a sentence written here.
 */
export function arenaDots(rows: readonly ArenaModel[] = settledModels()): readonly ArenaDot[] {
  const dots: ArenaDot[] = [];
  for (const model of rows) {
    const seconds = model.speed.median_seconds_per_page;
    const perHour = model.speed.serial_pages_per_hour;
    if (!model.omnidoc || seconds === null || perHour === null || model.speed.timed_pages === null) continue;
    dots.push({
      key: model.key,
      label: model.display_name,
      status: model.status,
      secondsPerPage: seconds,
      pagesPerHour: perHour,
      textEdit: model.omnidoc.text_edit,
      pages: model.omnidoc.pages,
      timedPages: model.speed.timed_pages,
    });
  }
  return dots;
}
