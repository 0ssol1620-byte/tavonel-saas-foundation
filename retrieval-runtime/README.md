# retrieval-runtime

A custom RunPod Flash service serving pinned BGE-M3 (embedding) and bge-reranker-v2-m3
(reranking) behind a small HTTP API — see `main.py`'s module docstring for the exact
pinned revisions and response schemas.

**STATUS: built and tested, but not the deployed Wave 2 GPU backend.** The actual
production path deploys the official Hugging Face Text Embeddings Inference image
(`ghcr.io/huggingface/text-embeddings-inference`) directly as two RunPod Load Balancer
Serverless endpoints, wired from `nextjs/lib/retrieval-runtime-config.ts` — no Dockerfile,
no registry credential, and no custom handler needed. `nextjs/lib/embedder-adapter-runpod.ts`
and `nextjs/lib/reranker-adapter-runpod.ts` speak TEI's own `/embed`/`/rerank` wire contract,
not this service's `tavonel.embedding_result.v1`/`tavonel.rerank_result.v1` envelopes.
This service is preserved as a working alternative backend (e.g. for a future customer VPC
deployment that cannot pull TEI's public image) — switching to it is a data change
(point `RETRIEVAL_RUNPOD_EMBEDDER_URL`/`RETRIEVAL_RUNPOD_RERANKER_URL` at it once deployed
and give the TS adapters its envelope format back), not something currently wired up.

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
