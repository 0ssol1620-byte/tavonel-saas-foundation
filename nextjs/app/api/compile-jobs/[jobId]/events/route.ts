import { isTerminalCompileState, readCompileJob, readCompileJobEvents } from "@/lib/compile-job-store";
import { memberSourcesRefusal } from "@/lib/member-source-scope";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { deriveSourceStages, type SourceStagesPayload } from "@/lib/compile-source-stages";
import { groupImmutableDocuments, selectCurrentDocumentVersions } from "@/lib/immutable-keys";
import { listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

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

/*
  Where each source is, from the objects that already exist. Read-only, and sent without an id
  so it cannot move the replay cursor: a reconnect resumes from the last durable event exactly as
  before. Any failure is silence -- the counter still works without it.

  ponytail: one bucket listing per viewer every SOURCES_EVERY_MS. If viewers of one workspace ever
  multiply, coalesce the listing per workspace; today the scheduled worker lists it once a minute.
*/
const SOURCES_EVERY_MS = 5_000;

async function readSourceStagesPayload(
  workspaceKey: string, documentIds: readonly string[], blocked: readonly { documentId: string }[],
): Promise<SourceStagesPayload | null> {
  try {
    const signer = readR2SignerEnv();
    if (!signer || documentIds.length === 0) return null;
    const listed = await listImmutableWorkspaceObjects(signer, workspaceKey);
    if (!listed.ok) return null;
    const { documents } = selectCurrentDocumentVersions(groupImmutableDocuments(workspaceKey, listed.objects));
    const now = Date.now();
    return { observedAt: new Date(now).toISOString(), stages: deriveSourceStages(documentIds, documents, blocked, now) };
  } catch {
    return null;
  }
}

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
  // A job over a source outside a member's scope streams nothing to them (WO-C-T3).
  const scopeRefusal = await memberSourcesRefusal(auth.principal, job.value.documentIds);
  if (scopeRefusal) {
    return new Response(JSON.stringify({ code: scopeRefusal.code }), {
      status: scopeRefusal.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const url = new URL(request.url);
  const header = request.headers.get("last-event-id");
  const requested = Number(header ?? url.searchParams.get("after") ?? "0");
  const after = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;

  const deadline = Date.now() + 50_000;
  let cursor = after;
  let lastSourcesAt = 0;
  let lastSources = "";
  const documentIds = Array.isArray(job.value.documentIds) ? job.value.documentIds : [];
  const watchSources = !isTerminalCompileState(job.value.state) && documentIds.length > 0;
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
          every minute) is the only runner. A viewer waits up to a tick per step, and one more tick
          per compile queued ahead in the same tick: the worker claims a compile only while a whole
          Core call still fits the tick (the worker's claim deadline), so at most one runs per tick.
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
        if (watchSources && Date.now() - lastSourcesAt >= SOURCES_EVERY_MS) {
          lastSourcesAt = Date.now();
          const payload = await readSourceStagesPayload(workspaceKey, documentIds, Array.isArray(job.value.blocked) ? job.value.blocked : []);
          const text = payload ? JSON.stringify(payload.stages) : "";
          // Only a change is sent; observedAt alone is not one.
          if (payload && text !== lastSources) {
            lastSources = text;
            if (!send(ENCODER.encode(`event: sources\ndata: ${JSON.stringify(payload)}\n\n`))) break;
          }
        }
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
