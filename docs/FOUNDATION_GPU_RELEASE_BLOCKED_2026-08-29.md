# GPU worker release — fail closed (2026-08-29 KST)

Foundation did **not** create a RunPod endpoint, image, or paid worker.

## Why

`decideSyntheticRunPodQualification` still returns `RELEASE_EVIDENCE_REQUIRED` until an immutable worker image, SBOM, manifest sha256, and human approval reference exist. Those artifacts are not in this repo.

Prior capacity snapshot `docs/evidence/runpod/list-gpu-types-2026-08-28.json` shows CUDA 12.9 available on some SKUs (for example H200 SXM and RTX 3090 Ti) and unavailable on others. There is no Seoul datacenter in that snapshot. H200 is well above the $5 synthetic ceiling for a meaningful qualification. Capacity alone does not authorize spend.

## Policy kept

- `$5` synthetic ceiling
- no SSH
- `minWorkers = 0`
- no persistent volume
- no ambiguous paid retry
- `activationPolicy.ocrGpu.enabled` remains false

A later release pack can be qualified independently. This document is not that pack.
