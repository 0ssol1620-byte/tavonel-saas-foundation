import Link from "next/link";
import type { Route } from "next";
import type { CollectionCandidateArtifact } from "@/lib/collection-compiler";
import styles from "./public-package-proof.module.css";

type Artifact = Pick<CollectionCandidateArtifact, "package" | "manifestDigest" | "lifecycle" | "candidatePromotion">;
type Source = {
  documentId: string;
  filename: string;
  href: string;
  sourceFilename: string;
  sourceHref: string;
  representationKind: "original" | "reference_render";
};

const USES: Readonly<Record<string, string>> = {
  source: "Trace the input document versions and their digests.",
  canonical: "Read objects, relations and evidence together as JSON.",
  obsidian: "Browse the source notes as Markdown.",
  ontology: "Read nodes and edges in Turtle; read node records with evidence IDs in JSON-LD.",
  graph: "Inspect the node and relationship tables as CSV.",
  rag: "Read the retrieval corpus with source, page and region references.",
  provenance: "Inspect the recorded OCR input events.",
  validation: "Check the validation results and review reasons.",
};

/** Only emitted files become rows; declared but empty roots are not package contents. */
export function buildPublicPackageProof(artifact: Artifact) {
  const groups = new Map<string, {
    root: string;
    use: string;
    files: Array<Omit<Artifact["package"]["files"][number], "content">>;
  }>();
  for (const { path, mediaType, sizeBytes, sha256 } of artifact.package.files) {
    const root = path.split("/")[0];
    let group = groups.get(root);
    if (!group) {
      group = { root, use: Object.hasOwn(USES, root) ? USES[root] : "Inspect this emitted projection.", files: [] };
      groups.set(root, group);
    }
    group.files.push({ path, mediaType, sizeBytes, sha256 });
  }
  return [...groups.values()];
}

export const CANONICAL_PREVIEW_LIMIT = 2048;

/** An exact bounded prefix of the emitted record, never a reconstructed JSON example. */
export function selectPublicCanonicalPreview(artifact: Artifact) {
  const file = artifact.package.files.find(item => item.path === "canonical/model.json");
  if (!file) return null;
  let end = Math.min(file.content.length, CANONICAL_PREVIEW_LIMIT);
  if (end < file.content.length) {
    const lineEnd = file.content.lastIndexOf("\n", end - 1);
    if (lineEnd >= 0) end = lineEnd + 1;
    // A single long line may have no boundary; keep its last surrogate pair intact.
    else if (/[\uD800-\uDBFF]/.test(file.content[end - 1])) end -= 1;
  }
  return { path: file.path, prefix: file.content.slice(0, end), truncated: end < file.content.length };
}

export default function PublicPackageProof({ artifact, sources, runtime }: {
  artifact: Artifact;
  sources: readonly Source[];
  runtime: string;
}) {
  const groups = buildPublicPackageProof(artifact);
  const preview = selectPublicCanonicalPreview(artifact);
  return <section id="public-package-proof" className={styles.proof} aria-labelledby="public-package-proof-title">
    <div className={styles.intro}>
      <p className={styles.eyebrow}>Inside the public sample</p>
      <h2 id="public-package-proof-title">One World. Files you can inspect.</h2>
      <p>These are the files emitted from the Apple filings behind Explore, with their formats and content digests.</p>
    </div>
    <dl className={styles.facts}>
      <div><dt>Emitted files</dt><dd>{artifact.package.files.length}</dd></div>
      <div><dt>Lifecycle</dt><dd>{artifact.lifecycle.replaceAll("_", " ")} · {artifact.candidatePromotion ? "activated" : "not activated"}</dd></div>
      <div><dt>Signing</dt><dd>{artifact.package.signatureStatus.replaceAll("_", " ")}</dd></div>
    </dl>
    <div className={styles.tree} aria-label="Emitted package files">
      {groups.map(group => <details className={styles.group} key={group.root} open={group.root === "canonical"}>
        <summary><span className={styles.groupHeading}><code>{group.root}/</code><span>{group.files.length} {group.files.length === 1 ? "file" : "files"}</span></span><span className={styles.use}>{group.use}</span></summary>
        <ul className={styles.files} role="list">
          {group.files.map(file => <li key={file.path} data-package-file={file.path}>
            <code className={styles.path}>{file.path}</code>
            <p className={styles.format}>{file.mediaType} · {file.sizeBytes.toLocaleString("en-US")} bytes</p>
            <dl className={styles.fileDigest}><dt>Full file content digest</dt><dd><code>{file.sha256}</code></dd></dl>
            {preview?.path === file.path ? <div className={styles.previewFrame}>
              <p id="canonical-content-preview-title" className={styles.previewTitle}>{preview.truncated ? "Truncated preview · opening content" : "Complete content preview"}</p>
              <p id="canonical-content-preview-note" className={styles.previewNote}>Scroll to read this JSON. The digest above identifies the full emitted file, not this preview.</p>
              <pre className={styles.preview} data-package-preview={file.path} tabIndex={0} role="region" aria-labelledby="canonical-content-preview-title" aria-describedby="canonical-content-preview-note"><code>{preview.prefix}</code></pre>
            </div> : null}
          </li>)}
        </ul>
      </details>)}
    </div>
    <details className={styles.integrity}>
      <summary>Sample sources and integrity</summary>
      <p>This is a public sample compiled by the TypeScript sample engine, not a customer compile or an activated customer World.</p>
      <dl className={styles.record}>
        <div><dt>Engine</dt><dd><code>{runtime}</code></dd></div>
        <div><dt>Manifest digest</dt><dd><code>{artifact.manifestDigest}</code></dd></div>
        <div><dt>Signing status</dt><dd><code>{artifact.package.signatureStatus}</code></dd></div>
      </dl>
      <p>The sample requires an external signer. Its file and manifest digests identify content; they do not verify a signature.</p>
      <p>The compiler reads the representations linked below. A reference render is a representation of the acquired source, rather than an original SEC PDF.</p>
      <ul className={styles.sources} role="list">
        {sources.map(source => <li key={source.documentId}>
          <span>{source.representationKind === "reference_render" ? "Reference render" : "Original PDF"}</span>
          <Link href={source.href as Route}>{source.filename}</Link>
          {source.representationKind === "reference_render" ? <Link href={source.sourceHref as Route}>Acquired original · {source.sourceFilename}</Link> : null}
        </li>)}
      </ul>
    </details>
    <nav className={styles.actions} aria-label="Explore the sample package">
      <Link href="/explore">Inspect the source evidence <span aria-hidden="true">↗</span></Link>
      <Link href="/docs/ontology-output">Read the output formats</Link>
      <Link href="/docs/use-with-ai">Use a World with AI</Link>
    </nav>
  </section>;
}
