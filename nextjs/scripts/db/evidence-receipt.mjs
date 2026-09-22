/**
 * Shared receipt-writing rules for the drills under `scripts/db/`.
 *
 * Both drills wrote `TAVONEL_<KIND>_DRILL_<date>.json` with an unconditional `writeFileSync`. Two
 * runs on one day therefore produced one file, and the second silently replaced the first --
 * "historical evidence overwritten" is a stop-the-line item in this repository's constitution, and
 * an operator re-running a drill after a failure is exactly when it would have happened.
 *
 * Two rules, kept here rather than copied into each drill, because a safety rule that exists twice
 * is a safety rule that will eventually only be fixed once:
 *
 *   The filename carries a discriminator from the drill's own identifier, so two runs on one day
 *   land in two files.
 *
 *   The write refuses a path that already exists. It does not append a counter and it does not
 *   overwrite. A receipt that cannot be written without destroying one is an operator decision,
 *   not a script's.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const RECEIPT_EXISTS_CODE = "RECEIPT_ALREADY_EXISTS";

/**
 * `TAVONEL_<PREFIX>_<YYYY-MM-DD>_<12 hex>.json`.
 *
 * The discriminator is the trailing 12 hex characters of the drill's own id -- the nonce suffix
 * for the restore drill, the tail of the `sha256:...` deletion id for the deletion drill. Both are
 * derived from that run's nonce, so two runs collide only if their nonces do.
 */
export function datedReceiptPath(prefix, now, drillId, directory) {
  const tail = /[0-9a-f]{12}$/.exec(String(drillId ?? "").toLowerCase())?.[0];
  if (!tail) throw new Error("RECEIPT_DRILL_ID_UNUSABLE");
  return resolve(directory, `TAVONEL_${prefix}_${now.toISOString().slice(0, 10)}_${tail}.json`);
}

/** Writes the receipt, or refuses because something is already there. Never overwrites. */
export function writeReceiptOnce(path, receipt) {
  if (existsSync(path)) return { ok: false, code: RECEIPT_EXISTS_CODE, path };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return { ok: true, path };
}
