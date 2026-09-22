import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// The builder is a plain .mjs script (tsconfig allowJs types it as it runs under `node`, no build step).
import { anomalySections, buildArtifact, REQUIRED_SOURCES } from "../scripts/benchmarks/build-model-arena-artifact.mjs";
import { MODEL_ARENA_ARTIFACT_SHA256 } from "./model-arena-page-data";

/*
  The guard over `scripts/benchmarks/build-model-arena-artifact.mjs`.

  The builder reads a campaign that lives in another repository, so this suite runs it against a
  fixture campaign it writes itself. Three properties are checked, and each one is a way the
  committed artifact could quietly stop meaning what the page says it means:

    1. A missing source stops the build. An artifact assembled from four of six reports still
       renders a full page, which is the failure mode that makes "bound by sha256" worthless.
    2. The same inputs produce the same bytes. Without that, "the digest moved" never
       distinguishes "the campaign changed" from "the key order changed".
    3. Every source is bound by the sha256 of the bytes this run read, not by a name.

  The fourth check only runs where the research tree is present: that the committed artifact is
  what a fresh build of the real campaign produces. CI does not have that tree, so the assertion
  is skipped there rather than faked.
*/

const ARENA_ROOT = "D:/CodexProjects/ai-knowledge-compiler/research/model_arena_20260903";
const ARTIFACT = path.join(import.meta.dirname, "..", "content", "benchmarks", "model-arena-20260903.json");

/** The smallest campaign the builder accepts: one settled row, one reference row, one excluded. */
function writeFixture(root: string, omit?: string): void {
  const files: Record<string, string> = {
    "reports/full_compare_20260905/LEADERBOARD_QUALITY_SPEED.json": JSON.stringify({
      generated_at_kst: "2026-09-06 19:55 KST",
      cloud_cost_usd: 0,
      speed_source: "campaign.sqlite",
      caveats: ["a caveat, verbatim"],
      omnidoc: {
        settled: [{
          model: "ovisocr2",
          text_edit: 0.029, formula_edit: 0.087, table_edit: 0.051,
          table_teds: 0.934, reading_order_edit: 0.113,
          pages: 1651, tag: "settled_full_1651_sequential",
          median_sec_per_page: 4, serial_pages_per_hour: 900,
          speed_n_success_timed: 5132, p90_sec_per_page: 10, speed_missing: false,
        }],
        reference: [{
          model: "opus5_subscription",
          text_edit: 0.09, formula_edit: 0.146, table_edit: 0.54,
          table_teds: 0.828, reading_order_edit: 0.167,
          pages: 1651, tag: "settled_full_1651_parallel",
          notes: ["REF; 21 prepare-skipped under full GT"],
          median_sec_per_page: null, serial_pages_per_hour: null,
          speed_n_success_timed: null, speed_missing: true,
        }],
        pending: ["infinity_parser2_pro"],
      },
      speed_reference_only: {
        infinity_parser2_pro: {
          median_sec_per_page: 9, serial_pages_per_hour: 400,
          speed_n_success_timed: 1521, p90_sec_per_page: 15, speed_missing: false,
        },
      },
    }),
    "reports/full_compare_20260905/comparison_omnidoc_full.json": JSON.stringify({
      generated_at_kst: "2026-09-06 20:26 KST",
      gt_full_pages: 1651,
      methodology: { evaluator: "OmniDocBench end2end quick_match", driver: "a driver" },
    }),
    "reports/full_compare_20260905/ANOMALY_NOTES.md":
      "# notes\n\n## ovisocr2 something\n\nThe verbatim note.\n\n## unrelated heading\n\nNot attached.\n",
    "reports/full_compare_20260905/STATUS.md": "# status\n",
    "model_registry.json": JSON.stringify({
      campaign_id: "TEST-CAMPAIGN",
      generated_at: "2026-09-05T03:01:01Z",
      models: {
        ovisocr2: { display_name: "OvisOCR2", license: "apache-2.0", container_image: null, container_digest: null, container_digest_unresolved_reason: "lane F", weights: { repo: "ATH-MaaS/OvisOCR2", revision: "1fc9221b" } },
        opus5_subscription: {
          display_name: "Claude Opus 5", license: "proprietary", api_model_id: "claude-opus-5",
          container_image: null, container_digest: null,
          list_price_reference: { captured_at: "2026-09-03", input_usd_per_mtok: 5, output_usd_per_mtok: 25, note: "never $0/page", source_url: "https://example.invalid" },
        },
        infinity_parser2_pro: { display_name: "Infinity-Parser2-Pro", license: "apache-2.0", container_image: null, container_digest: null, weights: { repo: "infly/Infinity-Parser2-Pro", revision: "b27d4701" } },
      },
    }),
    "evaluator_registry.json": JSON.stringify({
      evaluators: {
        omnidoc: {
          dataset_repository: "opendatalab/OmniDocBench",
          dataset_revision: "aa1ee96d",
          dataset_license: "research-only-non-commercial",
          dataset_redistribution: "prohibited_without_separate_rights_review",
          license: "Apache-2.0",
          main_pin: "193627ae",
          entrypoint: "python pdf_validation.py --config config.yaml",
        },
      },
    }),
    "evidence/canary-proof-ovisocr2.json": JSON.stringify({
      gpu_type: "NVIDIA GeForce RTX 4090",
      listed_rate_usd_per_hour: 0.74,
      price_snapshot_sha256: "sha256:7cc1f104",
      runtime_image_digest: "bootstrap:sha256:8b85d815",
      canary_verdict: "PASS",
    }),
  };
  for (const [relative, contents] of Object.entries(files)) {
    if (relative === omit) continue;
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
}

function withFixture<T>(run: (root: string) => T, omit?: string): T {
  const root = mkdtempSync(path.join(tmpdir(), "arena-fixture-"));
  try {
    writeFixture(root, omit);
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("the Model Arena artifact builder", () => {
  it("refuses to build when a required source is missing, and names the one that is", () => {
    for (const source of REQUIRED_SOURCES as string[]) {
      expect(() => withFixture((root) => buildArtifact(root), source)).toThrowError(
        new RegExp(`model_arena_source_missing: ${source.replace(/[/.]/g, "\\$&")}`),
      );
    }
  });

  it("produces the same bytes from the same inputs", () => {
    const first = withFixture((root) => buildArtifact(root));
    const second = withFixture((root) => buildArtifact(root));
    expect(second).toBe(first);
  });

  it("binds every source it read by the sha256 of those bytes", () => {
    withFixture((root) => {
      const artifact = JSON.parse(buildArtifact(root));
      expect(artifact.sources.length).toBeGreaterThanOrEqual(REQUIRED_SOURCES.length);
      for (const source of artifact.sources) {
        const bytes = readFileSync(path.join(root, source.path));
        expect(source.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      }
    });
  });

  it("carries a page count on every quality row and a timed-page count on every median", () => {
    withFixture((root) => {
      const artifact = JSON.parse(buildArtifact(root));
      for (const model of artifact.models) {
        if (model.omnidoc) expect(model.omnidoc.pages).toBeGreaterThan(0);
        if (model.speed.median_seconds_per_page !== null) {
          expect(model.speed.timed_pages).toBeGreaterThan(0);
        }
      }
    });
  });

  it("leaves hardware null with a stated reason when a model has no canary proof", () => {
    withFixture((root) => {
      const artifact = JSON.parse(buildArtifact(root));
      const opus = artifact.models.find((model: { key: string }) => model.key === "opus5_subscription");
      expect(opus.gpu.gpu_type).toBeNull();
      expect(opus.gpu.listed_usd_per_hour).toBeNull();
      expect(opus.gpu.absent_reason).toMatch(/no canary proof/);
    });
  });

  it("attaches an anomaly note to the row named in its heading, and to no other", () => {
    withFixture((root) => {
      const artifact = JSON.parse(buildArtifact(root));
      const ovis = artifact.models.find((model: { key: string }) => model.key === "ovisocr2");
      expect(ovis.notes).toHaveLength(1);
      expect(ovis.notes[0]).toMatch(/^ovisocr2 something\n/);
      expect(ovis.notes[0]).toContain("The verbatim note.");
      const others = artifact.models.filter((model: { key: string }) => model.key !== "ovisocr2");
      for (const model of others) expect(model.notes.join(" ")).not.toContain("The verbatim note.");
    });
  });

  it("splits the anomaly notes on their own headings", () => {
    const sections = anomalySections("# title\n\n## one\n\nbody one\n\n## two\n\nbody two\n");
    expect(sections.map((section: { heading: string }) => section.heading)).toEqual(["one", "two"]);
  });
});

describe("the committed artifact", () => {
  const present = existsSync(ARENA_ROOT);

  it.runIf(present)("is what a fresh build of the real campaign produces", () => {
    expect(buildArtifact(ARENA_ROOT)).toBe(readFileSync(ARTIFACT, "utf8").replace(/\r\n/g, "\n"));
  });

  it("hashes to the digest lib/model-arena-page-data.ts pins", () => {
    const bytes = readFileSync(ARTIFACT, "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(bytes, "utf8").digest("hex")).toBe(MODEL_ARENA_ARTIFACT_SHA256);
  });
});
