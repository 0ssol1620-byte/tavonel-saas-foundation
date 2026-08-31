"""Retrieval Compiler embedding + reranking runtime, deployed on RunPod via Flash.

Pinned models (never "latest" -- see nextjs/lib/retrieval-profile.ts and the model
governance receipts in nextjs/lib/embedder-adapter.ts / reranker-adapter.ts). Each model is
fetched by exact revision via snapshot_download into a local path, then loaded from that
local path -- this pins the revision regardless of whether the FlagEmbedding wrapper
classes themselves expose a `revision` kwarg:
  embedder: BAAI/bge-m3 @ 5617a9f61b028005a4858fdac845db406aefb181
  reranker: BAAI/bge-reranker-v2-m3 @ 953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e

Response schemas match nextjs/lib/embedder-adapter-runpod.ts and
nextjs/lib/reranker-adapter-runpod.ts exactly:
  tavonel.embedding_result.v1  {schemaVersion, status, dimension, vectors}
  tavonel.rerank_result.v1     {schemaVersion, status, ranked: [{id, score}]}

`flash dev` ships only each decorated function's body (see the runpod:flash skill,
Gotcha #1) -- a module-level helper function is NOT visible to a route running under
`flash dev`, even though it works under `flash deploy` (which imports the whole module).
Every route below therefore repeats its own imports and its own warm-worker model-loading
snippet (Gotcha #11: `global _MODEL; try: _MODEL \n except NameError: _MODEL = load()`)
rather than sharing one module-level loader.
"""

from runpod_flash import Endpoint, GpuGroup, PodTemplate

api = Endpoint(
    name="tavonel-retrieval-runtime",
    gpu=GpuGroup.ADA_24,
    workers=(0, 3),
    idle_timeout=120,
    dependencies=["FlagEmbedding", "torch", "transformers", "huggingface_hub", "sentencepiece", "protobuf"],
    template=PodTemplate(containerDiskInGb=40),
)


@api.get("/health")
async def health():
    return {"status": "ok"}


@api.get("/model-info")
async def model_info():
    return {
        "embedder": {
            "provider": "huggingface",
            "model": "BAAI/bge-m3",
            "revision": "5617a9f61b028005a4858fdac845db406aefb181",
            "dimension": 1024,
            "normalize": True,
        },
        "reranker": {
            "provider": "huggingface",
            "model": "BAAI/bge-reranker-v2-m3",
            "revision": "953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e",
        },
    }


@api.post("/embed/documents")
async def embed_documents(data: dict):
    texts = data.get("texts") if isinstance(data, dict) else None
    if not isinstance(texts, list) or len(texts) == 0:
        return {"schemaVersion": "tavonel.embedding_result.v1", "status": "error", "reason": "texts must be a non-empty array"}

    # mypy flags _EMBED_MODEL as name-defined on every line here: it is never assigned at
    # module level on purpose (see Gotcha #11 in the module docstring) -- a NameError on
    # first access is what makes the cache-or-load branch work at all.
    global _EMBED_MODEL
    try:
        model = _EMBED_MODEL  # type: ignore[name-defined]
    except NameError:
        from FlagEmbedding import BGEM3FlagModel
        from huggingface_hub import snapshot_download

        local_path = snapshot_download(repo_id="BAAI/bge-m3", revision="5617a9f61b028005a4858fdac845db406aefb181")
        _EMBED_MODEL = BGEM3FlagModel(local_path, use_fp16=True)  # type: ignore[name-defined]
        model = _EMBED_MODEL  # type: ignore[name-defined]

    instruction = (data.get("instruction") or "") if isinstance(data, dict) else ""
    inputs = [f"{instruction}{text}" if instruction else text for text in texts]
    output = model.encode(inputs, batch_size=12, max_length=8192)
    vectors = output["dense_vecs"].tolist()
    return {
        "schemaVersion": "tavonel.embedding_result.v1",
        "status": "ok",
        "dimension": len(vectors[0]) if vectors else 1024,
        "vectors": vectors,
    }


@api.post("/embed/query")
async def embed_query(data: dict):
    texts = data.get("texts") if isinstance(data, dict) else None
    if not isinstance(texts, list) or len(texts) != 1:
        return {
            "schemaVersion": "tavonel.embedding_result.v1",
            "status": "error",
            "reason": "texts must be a single-element array for embed/query",
        }

    # mypy flags _EMBED_MODEL as name-defined on every line here: it is never assigned at
    # module level on purpose (see Gotcha #11 in the module docstring) -- a NameError on
    # first access is what makes the cache-or-load branch work at all.
    global _EMBED_MODEL
    try:
        model = _EMBED_MODEL  # type: ignore[name-defined]
    except NameError:
        from FlagEmbedding import BGEM3FlagModel
        from huggingface_hub import snapshot_download

        local_path = snapshot_download(repo_id="BAAI/bge-m3", revision="5617a9f61b028005a4858fdac845db406aefb181")
        _EMBED_MODEL = BGEM3FlagModel(local_path, use_fp16=True)  # type: ignore[name-defined]
        model = _EMBED_MODEL  # type: ignore[name-defined]

    instruction = (data.get("instruction") or "") if isinstance(data, dict) else ""
    query_text = f"{instruction}{texts[0]}" if instruction else texts[0]
    output = model.encode([query_text], batch_size=1, max_length=8192)
    vectors = output["dense_vecs"].tolist()
    return {
        "schemaVersion": "tavonel.embedding_result.v1",
        "status": "ok",
        "dimension": len(vectors[0]) if vectors else 1024,
        "vectors": vectors,
    }


@api.post("/rerank")
async def rerank(data: dict):
    query = data.get("query") if isinstance(data, dict) else None
    candidates = data.get("candidates") if isinstance(data, dict) else None
    if not isinstance(query, str) or not query or not isinstance(candidates, list) or len(candidates) == 0:
        return {
            "schemaVersion": "tavonel.rerank_result.v1",
            "status": "error",
            "reason": "query and a non-empty candidates array are required",
        }

    # mypy flags _RERANK_MODEL as name-defined for the same reason as _EMBED_MODEL above.
    global _RERANK_MODEL
    try:
        model = _RERANK_MODEL  # type: ignore[name-defined]
    except NameError:
        from FlagEmbedding import FlagReranker
        from huggingface_hub import snapshot_download

        local_path = snapshot_download(repo_id="BAAI/bge-reranker-v2-m3", revision="953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e")
        _RERANK_MODEL = FlagReranker(local_path, use_fp16=True)  # type: ignore[name-defined]
        model = _RERANK_MODEL  # type: ignore[name-defined]

    pairs = [[query, candidate["text"]] for candidate in candidates]
    scores = model.compute_score(pairs, normalize=True)
    if not isinstance(scores, list):
        scores = [scores]
    ranked = [{"id": candidate["id"], "score": float(score)} for candidate, score in zip(candidates, scores)]

    top_k = data.get("topK") if isinstance(data, dict) else None
    if isinstance(top_k, int) and top_k > 0:
        ranked = sorted(ranked, key=lambda item: item["score"], reverse=True)[:top_k]

    return {"schemaVersion": "tavonel.rerank_result.v1", "status": "ok", "ranked": ranked}
