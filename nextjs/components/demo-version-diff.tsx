import styles from "./demo-version-diff.module.css";
import { demoWorldDiff } from "@/lib/demo-world-diff";

/*
  Gap #12 (V-12). The two Worlds either side of the change, compared.

  The step above this one states the change as text -- one figure struck through, one figure
  inserted -- and stops. What a reader wants next is whether the compile noticed, and this is the
  answer read off two artifacts rather than asserted: `lib/demo-world-diff.ts` compiles the
  corpus without the change notice and with it, and reports `diffWorldVersions` over the two.

  The claims are quoted, not summarised. Every Claim the second compile added is printed in the
  compiler's own words, which is how the sentence about revision B being superseded gets onto the
  page without anybody writing it here.

  The disclosure is inside the frame. The page carries one at the top, and this block can be
  screenshotted out of the page -- which the audit's own §5 item 15 warns about -- so the label
  travels with the picture rather than with the route.
*/

const shortDigest = (value: string) => `${value.replace(/^sha256:/, "sha256 ").slice(0, 20)}…`;

export default function DemoVersionDiff() {
  return (
    <div className={styles.diff} role="group" aria-labelledby="demo-version-diff-title">
      <p className={styles.head}>
        <span id="demo-version-diff-title">Two complete compiles of the same corpus</span>
        <span className={styles.disclosure}>PUBLIC SAMPLE · SYNTHETIC DATA</span>
      </p>

      <div className={styles.versions}>
        <section>
          <p className={styles.state}>BEFORE</p>
          <p className={styles.label}>{demoWorldDiff.before.label}</p>
          <code>{shortDigest(demoWorldDiff.before.manifestDigest)}</code>
          <small>{demoWorldDiff.before.objects.toLocaleString("en-US")} objects</small>
        </section>
        <span className={styles.arrow} aria-hidden="true">→</span>
        <section>
          <p className={styles.state}>AFTER</p>
          <p className={styles.label}>{demoWorldDiff.after.label}</p>
          <code>{shortDigest(demoWorldDiff.after.manifestDigest)}</code>
          <small>{demoWorldDiff.after.objects.toLocaleString("en-US")} objects</small>
        </section>
      </div>

      <dl className={styles.rows}>
        {demoWorldDiff.rows.map((row) => (
          <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
        ))}
      </dl>

      <p className={styles.state}>CLAIMS THE SECOND COMPILE ADDED</p>
      <ul className={styles.claims}>
        {demoWorldDiff.claims.map((claim) => (
          <li key={claim.id}>{claim.label}</li>
        ))}
      </ul>

      <p className={styles.fine}>
        Both Worlds above are complete compiles of their corpus, compared afterwards: nothing here
        was rebuilt in place, and a rebuilt count beside an added count is a report about two
        finished artifacts rather than a partial update. Neither was activated — both are
        candidates, and the comparison is between them. {demoWorldDiff.disclosure}
      </p>
    </div>
  );
}
