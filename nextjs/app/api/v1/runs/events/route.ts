import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { groupImmutableDocuments } from "@/lib/immutable-keys";
import { listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const encoder = new TextEncoder();

export async function GET(request: Request) {
  const auth = await authorizeFoundationRequest(request, "documents:read", "observer");
  if (!auth.ok) return Response.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const signer = readR2SignerEnv();
  if (!signer) return Response.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const workspaceId = auth.principal.workspaceKey;
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
        const listed = await listImmutableWorkspaceObjects(signer, workspaceId);
        if (!listed.ok) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ code: listed.code })}\n\n`));
          close();
          return;
        }
        const documents = groupImmutableDocuments(workspaceId, listed.objects);
        controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify({ code: "OK", observedAt: new Date().toISOString(), documents })}\n\n`));
        if (Date.now() - startedAt >= 20_000) { close(); return; }
        timer = setTimeout(() => void emit(), 4_000);
      };

      void emit().catch(() => {
        if (!closed) controller.enqueue(encoder.encode("event: error\ndata: {\"code\":\"RUN_STREAM_FAILED\"}\n\n"));
        close();
      });
    },
    cancel() { closed = true; if (timer) clearTimeout(timer); },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" } });
}
