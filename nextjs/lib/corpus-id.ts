import { createHash } from "node:crypto";

/**
 * The corpus's identity is its document set, exactly as a job's is.
 *
 * Same rule, same reason: resubmitting the same selection has to converge on the run that is
 * already going rather than start a second one beside it. Deriving the id from the set rather
 * than from a random value is what lets the parts be enqueued one at a time -- a submission
 * interrupted halfway through re-enqueues into the same corpus and the parts that exist are
 * returned unchanged.
 *
 * In its own module because `corpus-batching.ts` reaches the browser -- the workspace judges a
 * selection with it before the request is made -- and a `node:crypto` import there fails the
 * production build. Nothing in the client needs to compute a corpus id: the server answers
 * with the one it used.
 */
export function corpusIdFor(workspaceKey: string, documentIds: readonly string[]) {
  const canonical = [...new Set(documentIds)].sort().join("\n");
  return `corpus-${createHash("sha256").update(`corpus\n${workspaceKey}\n${canonical}`).digest("hex").slice(0, 32)}`;
}
