/**
 * Receipt writer. Tests run in several workers, so each entry is appended to receipt.ndjson under
 * V34_QA_OUT and `flushReceipt` folds the file into the single receipt.json. A screenshot's
 * sha256 and the commit SHA are carried per entry.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Violation } from "./v34-measure";

export type ReceiptEntry = {
  route: string;
  width: number;
  engine: string;
  colorScheme: "light" | "dark";
  pass: string;
  state?: string;
  ok: boolean;
  violations: Violation[];
  reported?: Violation[];
  excepted?: (Violation & { rationale: string })[];
  /** How many elements each pass measured (contrast: text, controls, and both again with the content details open). */
  checked?: Record<string, number>;
  screenshot?: string;
  screenshotSha256?: string;
  commit: string;
  timestamp: string;
  browserVersion?: string;
};

export const qaOut = (): string | null => process.env.V34_QA_OUT?.trim() || null;

export const routeKey = (route: string): string => (route === "/" ? "home" : route.replace(/^\/|\/$/g, "").replace(/\//g, "__"));

export function screenshotPath(out: string, engine: string, route: string, width: number, scheme: string): string {
  return path.join(out, engine, routeKey(route), `${width}-${scheme}.png`);
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function writeScreenshot(file: string, buffer: Buffer): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buffer);
  return sha256(buffer);
}

export function record(entry: Omit<ReceiptEntry, "commit" | "timestamp" | "ok"> & { ok?: boolean }): void {
  const out = qaOut();
  if (!out) return;
  mkdirSync(out, { recursive: true });
  const full: ReceiptEntry = {
    ...entry,
    ok: entry.ok ?? entry.violations.length === 0,
    commit: process.env.V34_QA_COMMIT ?? process.env.GITHUB_SHA ?? "unknown",
    timestamp: new Date().toISOString(),
  };
  appendFileSync(path.join(out, "receipt.ndjson"), `${JSON.stringify(full)}\n`);
}

/** Folds receipt.ndjson into receipt.json (atomic rename). Safe to call from every worker. */
export function flushReceipt(): string | null {
  const out = qaOut();
  if (!out) return null;
  const source = path.join(out, "receipt.ndjson");
  if (!existsSync(source)) return null;
  const entries = readFileSync(source, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as ReceiptEntry);
  const target = path.join(out, "receipt.json");
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(
    tmp,
    JSON.stringify({ generated: new Date().toISOString(), total: entries.length, failed: entries.filter(e => !e.ok).length, entries }, null, 2),
  );
  renameSync(tmp, target);
  return target;
}
