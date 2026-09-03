"use client";

import type { WorldOntology } from "@/lib/world-read-model";
import styles from "./world-ontology-viewer.module.css";

/*
  The compiled ontology, described by what it contains.

  Four things a customer asks of an ontology view: what classes exist, what properties relate
  them, what those properties actually connect, and how much of it is backed by evidence. All
  four are answerable from the artifact and all four are answered.

  The fifth -- the class hierarchy -- is not. The compiler emits no subclass axioms, so there
  is no hierarchy to draw, and drawing a plausible one would be inventing structure the
  customer would then reason about. The panel says that instead of showing a tree.

  Domain and range here are observed rather than declared: the types this predicate was
  actually used between in this World. That is a weaker claim, it is labelled as one, and it
  is the only one the artifact supports.
*/

export default function WorldOntologyViewer({ ontology }: { ontology: WorldOntology | null }) {
  if (!ontology || (ontology.classes.length === 0 && ontology.properties.length === 0)) {
    return (
      <section className={styles.empty} role="status">
        <span>READ_NOT_YET</span>
        <h3>No compiled ontology to read</h3>
        <p>No compiled object classes or relation properties are present in this World.</p>
      </section>
    );
  }

  const instances = ontology.classes.reduce((sum, entry) => sum + entry.instances, 0);
  const covered = ontology.classes.reduce((sum, entry) => sum + entry.withEvidence, 0);

  return (
    <div className={styles.viewer} data-sensitive="content">
      <p className={styles.summary}>
        {ontology.classes.length} class{ontology.classes.length === 1 ? "" : "es"} ·{" "}
        {ontology.properties.length} propert{ontology.properties.length === 1 ? "y" : "ies"} ·{" "}
        {covered} of {instances} instances carry evidence
      </p>

      <section aria-labelledby="ontology-classes">
        <h3 id="ontology-classes">Classes</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Class</th>
              <th scope="col">Instances</th>
              <th scope="col">With evidence</th>
              <th scope="col">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {ontology.classes.map((entry) => (
              <tr key={entry.name}>
                <th scope="row">{entry.name}</th>
                <td>{entry.instances}</td>
                <td>{entry.withEvidence}</td>
                <td>
                  {/* A bar and the number. The bar is the comparison; the number is the fact. */}
                  <span
                    className={styles.bar}
                    style={{ "--fill": `${entry.instances === 0 ? 0 : Math.round((entry.withEvidence / entry.instances) * 100)}%` } as React.CSSProperties}
                    aria-hidden="true"
                  />
                  {entry.instances === 0 ? "—" : `${Math.round((entry.withEvidence / entry.instances) * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="ontology-hierarchy">
        <h3 id="ontology-hierarchy">Hierarchy</h3>
        <p className={styles.notYet} role="status">
          <span>READ_NOT_YET</span>
          {ontology.hierarchy.state === "not_yet" ? ontology.hierarchy.reason : ""}
        </p>
      </section>

      <section aria-labelledby="ontology-properties">
        <h3 id="ontology-properties">Properties</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Property</th>
              <th scope="col">Domain (observed)</th>
              <th scope="col">Range (observed)</th>
              <th scope="col">Uses</th>
              <th scope="col">With evidence</th>
            </tr>
          </thead>
          <tbody>
            {ontology.properties.map((entry) => (
              <tr key={entry.name}>
                <th scope="row">{entry.name}</th>
                <td>{entry.domain.join(", ") || "—"}</td>
                <td>{entry.range.join(", ") || "—"}</td>
                <td>{entry.usages}</td>
                <td>{entry.withEvidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.note}>
          Domain and range are what this World used, not what the ontology declares. A compiled
          artifact records the relations it produced; it asserts no constraint on the ones it did not.
        </p>
      </section>

      <section aria-labelledby="ontology-exports">
        <h3 id="ontology-exports">Export mapping</h3>
        {ontology.exports.length === 0 ? (
          <p className={styles.note}>This World carries no ontology or graph export files.</p>
        ) : (
          <ul className={styles.exports}>
            {ontology.exports.map((file) => (
              <li key={file.path}>
                <strong>{file.path}</strong>
                <span>{file.mediaType}</span>
                <code>{file.sha256}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
