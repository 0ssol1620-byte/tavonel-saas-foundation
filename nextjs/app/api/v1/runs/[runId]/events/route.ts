import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { getJobStatus, listJobEvents } from "@/lib/job-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const encoder = new TextEncoder();

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const auth = await authorizeFoundationRequest(request, "documents:read", "observer");
  if (!auth.ok) return Response.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const { runId } = await context.params;
  const job = await getJobStatus(auth.principal.workspaceKey, runId);
  if (!job.ok) {
    return Response.json({ code: job.code }, { status: job.code === "JOB_NOT_FOUND" || job.code === "JOB_SCOPE_INVALID" ? 404 : 503, headers: { "Cache-Control": "no-store" } });
  }

  const lastEventId = request.headers.get("last-event-id");
  const headerSequence = lastEventId === null ? Number.NaN : Number.parseInt(lastEventId, 10);
  const after = new URL(request.url).searchParams.get("after");
  const urlSequence = after === null ? Number.NaN : Number.parseInt(after, 10);
  let cursor = Number.isSafeInteger(headerSequence) && headerSequence >= 0
    ? headerSequence
    : Number.isSafeInteger(urlSequence) && urlSequence >= 0 ? urlSequence : 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        controller.close();
      };
      request.signal.addEventListener("abort", close, { once: true });
      const startedAt = Date.now();
      const emit = async () => {
        if (closed) return;
        const result = await listJobEvents(auth.principal.workspaceKey, runId, cursor);
        if (!result.ok) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ code: result.code })}\n\n`));
          close();
          return;
        }
        for (const event of result.value) {
          cursor = event.sequence;
          controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: run\ndata: ${JSON.stringify(event)}\n\n`));
        }
        if (job.value.completedAt || Date.now() - startedAt >= 20_000) {
          controller.enqueue(encoder.encode(`event: end\ndata: ${JSON.stringify({ runId, lastSequence: cursor })}\n\n`));
          close();
          return;
        }
        controller.enqueue(encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`));
        timer = setTimeout(() => void emit(), 2_000);
      };
      void emit().catch(() => {
        if (!closed) controller.enqueue(encoder.encode("event: error\ndata: {\"code\":\"RUN_EVENT_STREAM_FAILED\"}\n\n"));
        close();
      });
    },
    cancel() { closed = true; if (timer) clearTimeout(timer); },
  });

  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  } });
}

