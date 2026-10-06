import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PublicPackageProof, { buildPublicPackageProof, CANONICAL_PREVIEW_LIMIT, selectPublicCanonicalPreview } from "../components/public-package-proof";
import { compileCollectionCandidate, validateCollectionOcrInput, type CollectionOcrInput } from "./collection-compiler";
import rawInputs from "./explore-sample.w4.inputs.json";
import rawSources from "./explore-sample.sources.json";

// The exact W4 inputs run through the production compiler, without compiling four unused snapshots.
const inputs = rawInputs.map(input => {
  const validated = validateCollectionOcrInput(input);
  if (!validated) throw new Error("public_package_proof_input_invalid");
  return validated;
}) as CollectionOcrInput[];
const artifact = compileCollectionCandidate(inputs);
const sources = rawSources.map(source => ({
  documentId: source.documentId,
  filename: source.representationFilename,
  href: `/explore-sample/${source.representationFilename}`,
  sourceFilename: source.sourceFilename,
  sourceHref: `/explore-sample/${source.sourceFilename}`,
  representationKind: source.representationKind as "original" | "reference_render",
}));
const runtime = "tavonel-collection-compiler-ts-v1/explore-sample";
const html = () => renderToStaticMarkup(createElement(PublicPackageProof, { artifact, sources, runtime }));

describe("public emitted-package proof", () => {
  it("shows an exact bounded canonical-file prefix ending at a complete line", () => {
    const file = artifact.package.files.find(item => item.path === "canonical/model.json")!;
    const preview = selectPublicCanonicalPreview(artifact)!;
    const end = file.content.lastIndexOf("\n", CANONICAL_PREVIEW_LIMIT - 1) + 1;
    expect(preview).toEqual({ path: file.path, prefix: file.content.slice(0, end), truncated: true });
    expect(preview.prefix.length).toBeLessThanOrEqual(CANONICAL_PREVIEW_LIMIT);
    expect(preview.prefix.endsWith("\n")).toBe(true);
    expect(file.content.startsWith(preview.prefix)).toBe(true);
    const markup = html();
    expect(markup).toContain(renderToStaticMarkup(createElement("code", null, preview.prefix)));
    expect(markup).toContain('data-package-preview="canonical/model.json"');
    expect(markup).toContain('tabindex="0" role="region" aria-labelledby="canonical-content-preview-title" aria-describedby="canonical-content-preview-note"');
    expect(markup).toContain("Truncated preview · opening content");
    expect(markup).toContain("Full file content digest");
    expect(markup).toContain("the full emitted file, not this preview");
    expect(markup).toContain(file.sha256);
    expect(`sha256:${createHash("sha256").update(preview.prefix).digest("hex")}`).not.toBe(file.sha256);
  });

  it("preserves raw text and safe escaping, without fabricating a missing-file fallback", () => {
    const canonical = artifact.package.files.find(item => item.path === "canonical/model.json")!;
    const raw = '  {\n    "text": "<script>& untouched"\n  }\n';
    const small = { ...artifact, package: { ...artifact.package, files: [{ ...canonical, content: raw }] } };
    expect(selectPublicCanonicalPreview(small)).toEqual({ path: canonical.path, prefix: raw, truncated: false });
    const markup = renderToStaticMarkup(createElement(PublicPackageProof, { artifact: small, sources, runtime }));
    expect(markup).toContain(renderToStaticMarkup(createElement("code", null, raw)));
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("Complete content preview");
    const absent = { ...artifact, package: { ...artifact.package, files: artifact.package.files.filter(file => file.path !== canonical.path) } };
    expect(selectPublicCanonicalPreview(absent)).toBeNull();
    expect(renderToStaticMarkup(createElement(PublicPackageProof, { artifact: absent, sources, runtime }))).not.toContain("data-package-preview");
  });

  it("keeps a surrogate pair intact when a long first line has no boundary", () => {
    const canonical = artifact.package.files.find(item => item.path === "canonical/model.json")!;
    const raw = "x".repeat(CANONICAL_PREVIEW_LIMIT - 1) + "😀 suffix";
    const fixture = { ...artifact, package: { ...artifact.package, files: [{ ...canonical, content: raw }] } };
    expect(selectPublicCanonicalPreview(fixture)).toEqual({ path: canonical.path, prefix: "x".repeat(CANONICAL_PREVIEW_LIMIT - 1), truncated: true });
  });

  it("describes Turtle edges separately from JSON-LD node records and evidence IDs", () => {
    const turtle = artifact.package.files.find(file => file.path === "ontology/knowledge.ttl")!;
    const jsonld = JSON.parse(artifact.package.files.find(file => file.path === "ontology/knowledge.jsonld")!.content);
    const edge = artifact.ontology.edges[0];
    expect(turtle.content).toContain(`<urn:tavonel:${edge.from}> tav:${edge.type} <urn:tavonel:${edge.to}> .`);
    expect(jsonld["@graph"]).toHaveLength(artifact.ontology.nodes.length);
    expect(jsonld["@graph"][0]).toEqual({ "@id": `urn:tavonel:${artifact.ontology.nodes[0].id}`, "@type": artifact.ontology.nodes[0].kind, label: artifact.ontology.nodes[0].label, evidence: artifact.ontology.nodes[0].evidenceIds });
    expect(html()).toContain("Read nodes and edges in Turtle; read node records with evidence IDs in JSON-LD.");
    expect(html()).not.toContain("same objects and relations as RDF or JSON-LD");
  });

  it("uses the exact frozen Explore artifact and only its emitted files", () => {
    const sampleSource = readFileSync(new URL("./explore-sample.ts", import.meta.url), "utf8");
    const frozenDigest = sampleSource.match(/export const EXPLORE_SAMPLE_DIGEST = "([^"]+)"/)?.[1];
    expect(frozenDigest).toBeDefined();
    expect(artifact.manifestDigest).toBe(frozenDigest);
    expect(sampleSource).toContain(`runtime: "${runtime}"`);
    const files = buildPublicPackageProof(artifact).flatMap(group => group.files);
    expect(files.map(file => file.path)).toEqual(artifact.package.files.map(file => file.path));
    for (const file of files) {
      const emitted = artifact.package.files.find(item => item.path === file.path)!;
      expect(file).toEqual({ path: emitted.path, mediaType: emitted.mediaType, sizeBytes: emitted.sizeBytes, sha256: emitted.sha256 });
      expect(file).not.toHaveProperty("content");
      expect(file.sizeBytes).toBe(Buffer.byteLength(emitted.content, "utf8"));
      expect(file.sha256).toBe(`sha256:${createHash("sha256").update(emitted.content).digest("hex")}`);
    }
  });

  it.each(["future", "constructor", "__proto__"])("does not invent declared roots or mislabel the unfamiliar projection %s", root => {
    const unfamiliar = { path: `${root}/item.json`, mediaType: "application/json", sizeBytes: 2, sha256: "sha256:fixture", content: "{}" };
    const groups = buildPublicPackageProof({ ...artifact, package: { ...artifact.package, roots: ["empty"], files: [unfamiliar] } });
    expect(groups).toEqual([{ root, use: "Inspect this emitted projection.", files: [{ path: unfamiliar.path, mediaType: unfamiliar.mediaType, sizeBytes: unfamiliar.sizeBytes, sha256: unfamiliar.sha256 }] }]);
  });

  it("renders full emitted paths and digests with honest lifecycle, engine and signing scope", () => {
    const markup = html();
    for (const file of artifact.package.files) {
      expect(markup).toContain(`data-package-file="${file.path}"`);
      expect(markup).toContain(file.sha256);
      expect(markup).toContain(file.mediaType);
    }
    expect(markup).toContain(artifact.manifestDigest);
    expect(markup).toContain("candidate · not activated");
    expect(markup).toContain(runtime);
    expect(markup).toContain("external_signer_required");
    expect(markup).toContain("they do not verify a signature");
    expect(markup).toContain("not a customer compile or an activated customer World");
    expect(markup).not.toContain("/reproducibility/sample-world");
    expect(markup).not.toContain("signature verified");
    const page = readFileSync(new URL("../app/product/compiled-world/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("<PublicPackageProof artifact={exploreSampleArtifact} sources={exploreSampleDocuments} runtime={exploreSampleArtifact.coreExecution.runtime} />");
  });

  it("preserves reference-render source distinctions and native disclosure/navigation semantics", () => {
    const markup = html();
    expect(markup).toContain('aria-labelledby="public-package-proof-title"');
    expect(markup).toContain('aria-label="Emitted package files"');
    expect(markup).toContain("Reference render");
    expect(markup).toContain("rather than an original SEC PDF");
    for (const source of sources) {
      expect(markup).toContain(`href="${source.href}"`);
      if (source.representationKind === "reference_render") expect(markup).toContain(`href="${source.sourceHref}"`);
    }
    expect((markup.match(/<summary>/g) ?? []).length).toBe(buildPublicPackageProof(artifact).length + 1);
    expect(markup).toMatch(/<details[^>]*open=""[^>]*><summary><span[^>]*><code>canonical\//);
    for (const href of ["/explore", "/docs/ontology-output", "/docs/use-with-ai"]) expect(markup).toContain(`href="${href}"`);
    expect(markup).not.toContain('role="tree"');
  });
});
