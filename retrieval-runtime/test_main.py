"""
Smoke-tests the request-shaping logic in main.py without real GPU/model weights:
FlagEmbedding, huggingface_hub, and runpod_flash are stubbed out with fakes before main.py
is imported, so no network call and no GPU are ever touched. This proves the input
validation, response shaping, and topK truncation are correct against the exact schemas
nextjs/lib/embedder-adapter-runpod.ts and nextjs/lib/reranker-adapter-runpod.ts expect --
it does NOT and cannot prove the real pinned models produce correct embeddings/rerank
scores. That requires an actual deployed RunPod worker (`flash dev` / `flash deploy`).

Run with: python test_main.py  (needs only numpy installed; not a runtime dependency of
main.py itself, which only imports it transitively via the real FlagEmbedding on RunPod).
"""

import asyncio
import os
import sys
import types


class FakeEmbedModel:
    def __init__(self, path, use_fp16=True):
        self.path = path

    def encode(self, texts, batch_size=12, max_length=8192):
        import numpy as np

        return {"dense_vecs": np.array([[float(len(t)), 0.0, 1.0] for t in texts])}


class FakeReranker:
    def __init__(self, path, use_fp16=True):
        self.path = path

    def compute_score(self, pairs, normalize=True):
        scores = [float(len(query) + len(doc)) for query, doc in pairs]
        return scores if len(scores) > 1 else scores[0]


class _EnumLike:
    def __getattr__(self, name):
        return name


class FakeEndpoint:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    def get(self, path):
        def decorator(fn):
            return fn

        return decorator

    def post(self, path):
        def decorator(fn):
            return fn

        return decorator


def _install_fakes():
    fake_flag_embedding = types.ModuleType("FlagEmbedding")
    fake_flag_embedding.BGEM3FlagModel = FakeEmbedModel
    fake_flag_embedding.FlagReranker = FakeReranker
    sys.modules["FlagEmbedding"] = fake_flag_embedding

    fake_hub = types.ModuleType("huggingface_hub")
    fake_hub.snapshot_download = lambda repo_id, revision: f"/fake/{repo_id}/{revision}"
    sys.modules["huggingface_hub"] = fake_hub

    fake_runpod_flash = types.ModuleType("runpod_flash")
    fake_runpod_flash.Endpoint = FakeEndpoint
    fake_runpod_flash.GpuGroup = _EnumLike()
    fake_runpod_flash.PodTemplate = lambda **kwargs: kwargs
    sys.modules["runpod_flash"] = fake_runpod_flash


_install_fakes()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import main

failures = []


def check(label, condition):
    print(("PASS" if condition else "FAIL") + " - " + label)
    if not condition:
        failures.append(label)


async def run():
    health = await main.health()
    check("health returns status ok", health == {"status": "ok"})

    info = await main.model_info()
    check(
        "model-info embedder revision matches pin",
        info["embedder"]["revision"] == "5617a9f61b028005a4858fdac845db406aefb181",
    )
    check(
        "model-info reranker revision matches pin",
        info["reranker"]["revision"] == "953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e",
    )

    empty = await main.embed_documents({"texts": []})
    check("embed_documents rejects empty texts", empty["status"] == "error")

    docs = await main.embed_documents({"texts": ["hello", "world!!"]})
    check("embed_documents returns one vector per input", len(docs["vectors"]) == 2)
    check(
        "embed_documents schemaVersion matches TS adapter contract",
        docs["schemaVersion"] == "tavonel.embedding_result.v1",
    )
    check("embed_documents dimension matches vector length", docs["dimension"] == len(docs["vectors"][0]))

    bad_query = await main.embed_query({"texts": ["a", "b"]})
    check("embed_query rejects a multi-element texts array", bad_query["status"] == "error")

    query = await main.embed_query({"texts": ["hello"]})
    check("embed_query returns exactly one vector", len(query["vectors"]) == 1)

    bad_rerank = await main.rerank({"query": "", "candidates": []})
    check("rerank rejects an empty query and empty candidates", bad_rerank["status"] == "error")

    reranked = await main.rerank(
        {
            "query": "q",
            "candidates": [{"id": "a", "text": "short"}, {"id": "b", "text": "a much longer candidate text"}],
        }
    )
    check("rerank schemaVersion matches TS adapter contract", reranked["schemaVersion"] == "tavonel.rerank_result.v1")
    check("rerank returns a score per candidate", len(reranked["ranked"]) == 2)
    check("rerank preserves candidate ids", {r["id"] for r in reranked["ranked"]} == {"a", "b"})

    top1 = await main.rerank(
        {
            "query": "q",
            "candidates": [{"id": "a", "text": "short"}, {"id": "b", "text": "a much longer candidate text"}],
            "topK": 1,
        }
    )
    check("rerank respects topK truncation", len(top1["ranked"]) == 1)
    check("rerank topK keeps the highest-scoring candidate", top1["ranked"][0]["id"] == "b")


asyncio.run(run())

if failures:
    print(f"\n{len(failures)} FAILURE(S): {failures}")
    sys.exit(1)
print("\nAll checks passed.")
