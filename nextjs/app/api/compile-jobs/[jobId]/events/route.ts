import { isTerminalCompileState, readCompileJob, readCompileJobEvents } from "@/lib/compile-job-store";
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
      while (!closed && !settled && Date.now() < deadline) {
        /*
          A reader only. This loop used to run a compile turn in-process every 3 s, which
          meant a 60 s stream could take the compile lease and start Core with seconds left on its
          own clock: cjob-157f2f23 leased at 07:11:15, the stream was killed at 07:11:25, and the
          job sat on a dead lease for five minutes. The scheduled worker (`/api/internal/jobs/run`,
          every minute) is the only runner; this stream costs the viewer at most a minute.
        */
        const events = await readCompileJobEvents(workspaceKey, jobId, cursor);
        if (!events.ok) {
          send(frame(cursor, "error", { code: events.code }));
          break;
        }
        for (const event of events.value) {
          cursor = event.sequence;
          if (!send(frame(event.sequence, event.eventType, event))) break;
          // Terminal is the last word. Nothing after it is sent: a later row (cjob-157f2f23
          // seq 159, `structuring` after `failed`) would otherwise overwrite the settled view.
          if (isTerminalCompileState(event.state)) { settled = true; break; }
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
