import type { CompileBlocker, CompileState } from "./compile-job-store";

/*
  Watching a durable compile from the browser.

  This is a hand-rolled event-stream reader rather than `EventSource`, for one reason:
  `EventSource` cannot send an Authorization header, and the workspace authenticates with a
  Supabase bearer token. Doing it over `fetch` costs a parser and buys back the two things
  that actually matter here -- the token, and explicit control of the resume cursor.

  Nothing in this file is load-bearing for correctness. The compile runs on the server whether
  or not anyone is reading; if every line here failed the job would still finish, and a
  reader that reconnects an hour later still gets the whole history. That is the property the
  old design lacked, where closing the tab abandoned the run.
*/

export type CompileJobFrame = {
  sequence: number;
  eventType: string;
  state: CompileState;
  documentsTotal: number;
  documentsReady: number;
  errorCode: string | null;
  blocked: CompileBlocker[];
  collectionId: string | null;
};

export type SseFrame = { id: number | null; event: string; data: string };

/**
 * Split a stream buffer into complete frames, returning the unconsumed tail.
 *
 * Frames are separated by a blank line; anything after the last one is a partial frame and
 * has to survive until the next chunk arrives. Getting that wrong is the classic bug in a
 * hand-written SSE reader -- a frame split across a TCP boundary is silently dropped, which
 * shows up as a compile that "sometimes" misses its completion event.
 */
export function drainSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  let rest = buffer.replace(/\r\n/g, "\n");
  for (;;) {
    const boundary = rest.indexOf("\n\n");
    if (boundary === -1) break;
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    let id: number | null = null;
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      // A line starting with ':' is a comment -- the keepalive ping. It carries no id and must
      // not disturb the cursor, or a reconnect would replay from the wrong place.
      if (line.startsWith(":") || line.length === 0) continue;
      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
      if (field === "id") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) id = parsed;
      } else if (field === "event") {
        event = value;
      } else if (field === "data") {
        data.push(value);
      }
    }
    if (data.length > 0 || event !== "message") frames.push({ id, event, data: data.join("\n") });
  }
  return { frames, rest };
}

export function frameFromEvent(raw: unknown): CompileJobFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.sequence !== "number" || typeof row.state !== "string") return null;
  const detail = (row.detail && typeof row.detail === "object" ? row.detail : {}) as Record<string, unknown>;
  return {
    sequence: row.sequence,
    eventType: typeof row.eventType === "string" ? row.eventType : "state_changed",
    state: row.state as CompileState,
    documentsTotal: Number(row.documentsTotal ?? 0),
    documentsReady: Number(row.documentsReady ?? 0),
    errorCode: typeof row.errorCode === "string" ? row.errorCode : null,
    blocked: Array.isArray(detail.blocked) ? (detail.blocked as CompileBlocker[]) : [],
    collectionId: typeof detail.collectionId === "string" ? detail.collectionId : null,
  };
}

/*
 * Where the observer stops.
 *
 * Three of these are terminal. `review_required` is not -- the job is waiting for a person
 * to look at a package -- but nothing further will happen on its own, so a reader that kept
 * reconnecting would hold a connection open for hours to watch nothing change.
 */
const RESTING: readonly string[] = ["ready", "failed", "cancelled", "review_required"];

export type ObserveOptions = {
  jobId: string;
  /** Read afresh each attempt: a stream that lives across a token refresh must not pin one. */
  authToken: () => Promise<string | null>;
  onFrame: (frame: CompileJobFrame) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Overridable so a test does not spend real seconds on the backoff. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Follow one job to its end, reconnecting as often as it takes.
 *
 * The server closes the stream at its own wall clock rather than holding it open forever, so
 * a reconnect is the normal case and not an error path -- it happens roughly once a minute
 * during a long compile, which means the resume is exercised continuously instead of only
 * during the outage it was written for.
 */
export async function observeCompileJob(options: ObserveOptions): Promise<CompileState | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let cursor = 0;
  let settled: CompileState | null = null;
  let failures = 0;

  while (!settled && !options.signal?.aborted) {
    const token = await options.authToken();
    if (!token) return null;
    try {
      const response = await doFetch(`/api/compile-jobs/${options.jobId}/events?after=${cursor}`, {
        headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
        signal: options.signal,
        cache: "no-store",
      });
      if (!response.ok || !response.body) {
        // 4xx is terminal for this observer: the job is gone or not ours, and retrying an
        // authorization failure in a loop helps nobody.
        if (response.status >= 400 && response.status < 500) return null;
        throw new Error(String(response.status));
      }
      failures = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const drained = drainSseFrames(buffer);
        buffer = drained.rest;
        for (const raw of drained.frames) {
          if (raw.id !== null) cursor = Math.max(cursor, raw.id);
          if (raw.event === "done" || raw.event === "idle" || raw.event === "error") continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.data);
          } catch {
            continue;
          }
          const frame = frameFromEvent(parsed);
          if (!frame) continue;
          options.onFrame(frame);
          if (RESTING.includes(frame.state)) settled = frame.state;
        }
      }
    } catch {
      if (options.signal?.aborted) break;
      failures += 1;
      // Bounded backoff. A server that is down does not get hammered, and a customer watching
      // a live compile does not wait a minute for the connection to come back.
      await sleep(Math.min(1_000 * 2 ** Math.min(failures, 4), 15_000));
      continue;
    }
    if (!settled && !options.signal?.aborted) await sleep(300);
  }
  return settled;
}
