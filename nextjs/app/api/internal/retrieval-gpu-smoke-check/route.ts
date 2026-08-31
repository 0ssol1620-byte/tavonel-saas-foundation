import { NextResponse } from "next/server";
import { readRetrievalRuntimeEnv, createProductionEmbedderAdapter, createProductionRerankerAdapter } from "@/lib/retrieval-runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// TEMPORARY Wave 2 diagnostic route -- proves the deployed RunPod TEI endpoints work end to
// end using this deployment's own RETRIEVAL_RUNPOD_EMBEDDER_URL / RETRIEVAL_RUNPOD_RERANKER_URL
// / RUNPOD_API_KEY (never returned to the caller), without any caller ever handling that
// credential directly. DELETE THIS ROUTE once the Wave 2 GPU smoke test is confirmed --
// it is not part of the product surface and exists only to verify the deploy.
//
// Gated by a throwaway token (not a real secret-rotation system) purely so the route
// can't be hit by a random crawler and burn GPU spend; remove alongside the route.
const SMOKE_TEST_TOKEN = "bce2ef936e60509b4ec9f77e9d528243360a3c5ab5076913";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (request.headers.get("x-smoke-test-token") !== SMOKE_TEST_TOKEN) {
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403, headers });
  }

  const env = readRetrievalRuntimeEnv();
  if (!env) {
    return NextResponse.json({ code: "RETRIEVAL_RUNTIME_NOT_CONFIGURED" }, { status: 503, headers });
  }

  const embedder = createProductionEmbedderAdapter(env);
  const reranker = createProductionRerankerAdapter(env);

  const embedResult = await embedder.embedQuery("TAVONEL은 신뢰할 수 있는 AI 지식 컴파일러다");

  const rerankResult = await reranker.rerank("TAVONEL이 뭐야?", [
    { id: "a", text: "TAVONEL은 신뢰할 수 있는 AI 지식 컴파일러다" },
    { id: "b", text: "오늘 날씨는 맑음" },
  ]);

  return NextResponse.json(
    {
      code: "OK",
      embed:
        embedResult.status === "ok"
          ? { status: "ok", dimension: embedResult.vectors[0]?.length ?? 0, sample: embedResult.vectors[0]?.slice(0, 5), durationMs: embedResult.receipt.durationMs }
          : { status: "error", reason: embedResult.reason, durationMs: embedResult.receipt.durationMs },
      rerank:
        rerankResult.status === "ok"
          ? { status: "ok", ranked: rerankResult.ranked, durationMs: rerankResult.receipt.durationMs }
          : { status: "error", reason: rerankResult.reason, durationMs: rerankResult.receipt.durationMs },
    },
    { headers },
  );
}
