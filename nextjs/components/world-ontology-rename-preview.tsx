"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { WorldOntology } from "@/lib/world-read-model";
import {
  PROPOSED_CLASS_NAME_MAX,
  previewClassRename,
  type ClassRenamePreview,
  type ClassRenameRefusalReason,
} from "@/lib/ontology-class-rename-preview";
import styles from "./world-ontology-viewer.module.css";

/*
  "Preview a class name" -- a local draft, not an edit.

  The customer picks a compiled class, types a name, and sees that class's own counts and the
  observed properties that use it, next to the name they proposed. Nothing leaves this
  component: no request, no storage, no toast that says something was saved, because nothing
  was. The draft lives in component state, and the viewer keys this component by the
  ontology's content, so a changed ontology starts a fresh draft in the same render rather
  than showing an old preview over new data.

  The preview is computed from what was submitted, and editing either field drops it: the
  numbers on screen always belong to the class and name shown beside them.
*/

type Submitted = { sourceClass: string; proposedName: string };

const NAME_REASONS: ReadonlySet<ClassRenameRefusalReason> = new Set<ClassRenameRefusalReason>([
  "empty_name",
  "too_long",
  "control_character",
  "unchanged",
  "collides_with_existing_class",
]);

export default function WorldOntologyRenamePreview({ ontology }: { ontology: WorldOntology }) {
  const id = useId();
  const headingId = `${id}-heading`;
  const classId = `${id}-class`;
  const nameId = `${id}-name`;
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const resultId = `${id}-result`;

  const firstClass = ontology.classes[0]?.name ?? "";
  const [sourceClass, setSourceClass] = useState<string>(firstClass);
  const [proposedName, setProposedName] = useState("");
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const outcome = useMemo(
    () => (submitted ? previewClassRename(ontology, submitted.sourceClass, submitted.proposedName) : null),
    [ontology, submitted],
  );

  if (ontology.classes.length === 0) {
    return (
      <section className={styles.rename} aria-labelledby={headingId}>
        <h3 id={headingId}>Preview a class name</h3>
        <p className={styles.note}>This World has no compiled classes, so there is no class name to preview.</p>
      </section>
    );
  }

  const nameRefused = outcome?.state === "refused" && NAME_REASONS.has(outcome.reason);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted({ sourceClass, proposedName });
  }

  function clear() {
    setSourceClass(firstClass);
    setProposedName("");
    setSubmitted(null);
    nameInput.current?.focus();
  }

  return (
    <section className={styles.rename} aria-labelledby={headingId}>
      <h3 id={headingId}>Preview a class name</h3>
      <p className={styles.note}>
        Try a different name for a compiled class and see what it covers. This is a local draft:
        nothing is renamed or saved, and the compiled World stays as it is.
      </p>

      {/* No `name` attributes and no action: the values never become part of a URL or a request. */}
      <form className={styles.renameForm} onSubmit={submit} noValidate>
        <div className={styles.renameField}>
          <label htmlFor={classId}>Class</label>
          <select
            id={classId}
            value={sourceClass}
            onChange={(event) => {
              setSourceClass(event.target.value);
              setSubmitted(null);
            }}
          >
            {ontology.classes.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.renameField}>
          <label htmlFor={nameId}>Proposed name</label>
          <input
            ref={nameInput}
            id={nameId}
            type="text"
            value={proposedName}
            autoComplete="off"
            aria-invalid={nameRefused || undefined}
            aria-describedby={nameRefused ? `${hintId} ${statusId}` : hintId}
            onChange={(event) => {
              setProposedName(event.target.value);
              setSubmitted(null);
            }}
          />
        </div>

        <div className={styles.renameActions}>
          <button type="submit" className={styles.renameButton} aria-controls={resultId}>
            Preview
          </button>
          <button type="button" className={styles.renameSecondary} onClick={clear}>
            Clear draft
          </button>
        </div>

        <p id={hintId} className={styles.renameHint}>
          Up to {PROPOSED_CLASS_NAME_MAX} characters. Any script and spaces are fine; line breaks
          and control characters are not.
        </p>
      </form>

      {/* Always mounted, so the first message after a submit is announced. */}
      <p id={statusId} className={styles.renameStatus} role="status" aria-live="polite">
        {outcome === null
          ? ""
          : outcome.state === "refused"
            ? outcome.message
            : `Preview below: ${outcome.sourceClass} shown as ${outcome.proposedName}. Nothing has been renamed or saved.`}
      </p>

      <div id={resultId}>
        {outcome?.state === "preview" ? <ClassRenamePreviewResult preview={outcome} /> : null}
      </div>
    </section>
  );
}

const ROLE_TEXT: Record<string, string> = {
  domain: "Domain",
  range: "Range",
  "domain,range": "Domain and range",
};

/** The preview itself. Exported so its wording can be rendered and read on its own. */
export function ClassRenamePreviewResult({ preview }: { preview: ClassRenamePreview }) {
  const headingId = `${useId()}-preview`;
  return (
    <section className={styles.renameResult} aria-labelledby={headingId}>
      <h4 id={headingId}>Draft preview</h4>
      <dl className={styles.renameFacts}>
        <div>
          <dt>Current class</dt>
          <dd><code>{preview.sourceClass}</code></dd>
        </div>
        <div>
          <dt>Proposed name</dt>
          <dd>{preview.proposedName}</dd>
        </div>
        <div>
          <dt>Instances</dt>
          <dd>{preview.instances}</dd>
        </div>
        <div>
          <dt>With evidence</dt>
          <dd>{preview.withEvidence} of {preview.instances}</dd>
        </div>
        <div>
          <dt>Observed properties</dt>
          <dd>{preview.properties.length}</dd>
        </div>
      </dl>

      {preview.properties.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Property</th>
              <th scope="col">Uses this class as (observed)</th>
            </tr>
          </thead>
          <tbody>
            {preview.properties.map((property) => (
              <tr key={property.name}>
                <th scope="row">{property.name}</th>
                <td>{ROLE_TEXT[property.roles.join(",")]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <ul className={styles.renameNotes}>
        {preview.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}
