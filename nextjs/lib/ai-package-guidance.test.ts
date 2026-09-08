import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_PACKAGE_CONTENTS,
  AI_PACKAGE_SUMMARY,
  AI_USE_JOURNEY,
  buildAiPackageGuidance,
} from "./ai-package-guidance";

describe("AI package guidance", () => {
  it("gives a filesystem-capable agent a deterministic grounded entrypoint", () => {
    const guidance = buildAiPackageGuidance({
      collectionId: `collection-${"a".repeat(32)}`,
      manifestDigest: `sha256:${"b".repeat(64)}`,
      lifecycle: "candidate",
      worldStateId: "world-state-1",
    });
    expect(guidance.readme).toContain("Read AGENTS.md in this folder first");
    expect(guidance.readme).toContain("A filesystem path by itself does not grant an AI access");
    expect(guidance.readme).toContain("TAVONEL MCP/API is the preferred integration");
    expect(guidance.readme).toContain("## Ontology quickstart");
    expect(guidance.readme).toContain("urn:tavonel:<id>");
    expect(guidance.readme).toContain("do not assume it is a hand-authored OWL/TBox schema");
    expect(guidance.agents).toContain("validation/report.json");
    expect(guidance.agents).toContain("Never invent a missing locator");
    expect(guidance.entrypoint.portableEntrypoints.retrievalChunks).toBe("rag/chunks.jsonl");
    expect(guidance.entrypoint.authoritativeUse).toBe("verify_active_world_status");
  });

  it("refuses to describe review-required output as authoritative", () => {
    const guidance = buildAiPackageGuidance({
      collectionId: `collection-${"c".repeat(32)}`,
      manifestDigest: `sha256:${"d".repeat(64)}`,
      lifecycle: "review_required",
    });
    expect(guidance.readme).toContain("requires human review");
    expect(guidance.entrypoint.authoritativeUse).toBe("blocked_pending_review");
  });
});

describe("workspace AI usage guidance", () => {
  it("walks the five-step journey in the order it happens", () => {
    expect([...AI_USE_JOURNEY]).toEqual([
      "Compile and activate a World",
      "Create API/MCP access",
      "Query the active World",
      "Receive evidence-bound context",
      "Follow citations back to source",
    ]);
  });

  it("advertises only files the export actually writes", () => {
    /*
      The list on screen and the archive on disk have to be the same list. `collection-download.ts`
      is what assembles the ZIP, so every advertised path has to be a path it names -- a file
      renamed or dropped there fails here rather than becoming a promise the download breaks.
    */
    const exporter = readFileSync("lib/collection-download.ts", "utf8");
    for (const file of AI_PACKAGE_CONTENTS) {
      expect(exporter, `${file.path} is advertised but the exporter never writes it`)
        .toContain(`"${file.path}"`);
      expect(file.purpose.length).toBeGreaterThan(0);
    }
    const paths = AI_PACKAGE_CONTENTS.map((file) => file.path);
    expect(paths).toContain("manifest/ai-entrypoint.json");
    expect(paths).toContain("signatures/export-manifest.ed25519.json");
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("describes the package without promising automatic understanding", () => {
    expect(AI_PACKAGE_SUMMARY).toContain("helps AI understand your organization accurately and currently");
    expect(AI_PACKAGE_SUMMARY).toContain("does not make a model understand your organization on its own");
    for (const forbidden of ["automatically understands everything", "100% accurate", "never hallucinates", "better than RAG"]) {
      expect(AI_PACKAGE_SUMMARY.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
