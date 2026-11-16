import { notFound } from "next/navigation";
import { connection } from "next/server";
import { v34Route, type V34RouteKey } from "./routes";

export function isHeld(key: V34RouteKey): boolean {
  return v34Route(key).release === "held";
}

/** Fail closed: only preview deployments and an explicit V34_SHOW_HELD=1 may render a held route. */
export function heldVisible(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.VERCEL_ENV === "preview" || env.V34_SHOW_HELD === "1";
}

/**
 * Call first in a page body. A live route returns at once and stays static. A held route opts into
 * dynamic rendering so the environment is read per request, then answers 404 unless visible.
 */
export async function releaseGate(key: V34RouteKey): Promise<void> {
  if (!isHeld(key)) return;
  await connection();
  if (heldVisible()) return;
  notFound();
}
