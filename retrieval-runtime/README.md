# retrieval-runtime

RunPod Flash service backing `EmbedderAdapter`/`RerankerAdapter`
(`nextjs/lib/embedder-adapter-runpod.ts`, `nextjs/lib/reranker-adapter-runpod.ts`). Serves
pinned BGE-M3 (embedding) and bge-reranker-v2-m3 (reranking) behind a small HTTP API — see
`main.py`'s module docstring for the exact pinned revisions and response schemas.

## Local iteration

```bash
uv tool install --python 3.13 runpod-flash   # or: pip install runpod-flash
flash login                                   # or: export RUNPOD_API_KEY=...
cd retrieval-runtime
flash dev
```

`flash dev` runs a local server whose routes execute on a real remote GPU worker. Routes
are namespaced by file: `main.py`'s `/health` is served at `/main/health`, etc.

## Deploy

```bash
flash deploy
```

Only do this once every route has been exercised under `flash dev`. Record the resulting
endpoint URL in `RUNPOD_EMBEDDING_URL`/`RUNPOD_API_KEY` for the TS adapters.

## Testing without a GPU

```bash
python test_main.py
```

Stubs out `FlagEmbedding`, `huggingface_hub`, and `runpod_flash` so no network call and no
GPU are touched. This proves the request-shaping/validation logic and response schemas are
correct; it cannot prove the real pinned models produce correct embeddings or rerank
scores — that requires an actual `flash dev`/`flash deploy` run against a live worker.
