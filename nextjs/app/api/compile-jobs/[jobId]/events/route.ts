import { isTerminalCompileState, readCompileJob, readCompileJobEvents } from "@/lib/compile-job-store";
import { runCompileJobTurn } from "@/lib/compile-job-worker";
import { authorizeFoundationRequest } from "@/lib/developer-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/*
  The transition log as a stream, resumable from any point.

  Two properties make this a resume rather than a subscription.

  The events are persisted before they are sent -- a trigger writes every transition to an
  append-only table -- so the stream is a *reader* of durable history, not the history itself.
  Nothing is lost when a connection drops, because nothing was ever only in the connection.

  And the id of each frame is that row's sequence, which is what `EventSource` echoes back in
  `Last-Event-ID` when it reconnects on its own. A client that was disconnected for four
  minutes reconnects and receives exactly the frames it missed, in order, before any new one.
  That is also why the handler ends deliberately at its wall clock instead of being held open:
  the reconnect is the supported path, exercised every sixty seconds rather than only during
  an outage.

  A poller on GET /api/compile-jobs/{jobId} sees the same states. Anyone behind a proxy that
  buffers event streams should use it, and loses nothing but latency.
*/
const ENCODER = new TextEncoder();

function frame(id: number, event: string, data: unknown) {
  return ENCODER.encode(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const auth = await authorizeFoundationRequest(request, "collections:read", "observer");
  if (!auth.ok) {
    return new Response(JSON.stringify({ code: auth.code }), {
      status: auth.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const workspaceKey = auth.principal.workspaceKey;
  const { jobId } = await context.params;

  // Confirm the job is this tenant's before opening a stream, so an unauthorized id gets an
  // ordinary 404 rather than a long-lived connection that never produces anything.
  const job = await readCompileJob(workspaceKey, jobId);
  if (!job.ok) {
    const status = job.code === "COMPILE_JOB_NOT_FOUND" ? 404
      : job.code === "COMPILE_JOB_SCOPE_INVALID" ? 400
      : 503;
    return new Response(JSON.stringify({ code: job.code }), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const url = new URL(request.url);
  const header = request.headers.get("last-event-id");
  const requested = Number(header ?? url.searchParams.get("after") ?? "0");
  const after = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;

  const deadline = Date.now() + 50_000;
  let cursor = after;
  let closed = false;
  request.signal.addEventListener("abort", () => { closed = true; });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: Uint8Array) => {
        if (closed) return false;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      // Tell proxies not to buffer, and give the client a reconnect floor.
      send(ENCODER.encode(": open\nretry: 3000\n\n"));

      let settled = false;
      let nudgedAt = 0;
      while (!closed && !settled && Date.now() < deadline) {
        /*
          Give the job a push while someone is watching.

          The cron turns this crank once a minute whether or not anyone has the workspace open,
          which is what makes the compile durable. That cadence is fine for a run nobody is
          looking at and far too slow for one somebody is. So a live viewer nudges the same
          worker function in-process -- not a second implementation, and not a privilege the
          browser gains: the caller was already authorized for this workspace and the turn
          touches only this job. Remove it and the compile still finishes, a minute later.
        */
        if (Date.now() - nudgedAt > 3_000) {
          nudgedAt = Date.now();
          const current = await readCompileJob(workspaceKey, jobId);
          if (current.ok && !isTerminalCompileState(current.value.state)) {
            await runCompileJobTurn(current.value).catch(() => undefined);
          }
        }
        const events = await readCompileJobEvents(workspaceKey, jobId, cursor);
        if (!events.ok) {
          send(frame(cursor, "error", { code: events.code }));
          break;
        }
        for (const event of events.value) {
          cursor = event.sequence;
          if (!send(frame(event.sequence, event.eventType, event))) break;
          if (isTerminalCompileState(event.state)) settled = true;
        }
        if (settled || closed) break;
        // A comment frame, so a silent job still holds the connection open through a proxy
        // with an idle timeout. It carries no id and cannot disturb the replay cursor.
        if (!send(ENCODER.encode(": ping\n\n"))) break;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }

      if (!closed) {
        // `done` when there is nothing more to say; otherwise the client reconnects from
        // `cursor` and continues. Either way this frame is advisory: the state of record is
        // the row, and the client re-reads it if it doubts the stream.
        send(frame(cursor, settled ? "done" : "idle", { settled, cursor }));
        try { controller.close(); } catch { /* already closed by the client */ }
      }
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
