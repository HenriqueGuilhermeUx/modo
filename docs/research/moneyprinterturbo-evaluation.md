# MoneyPrinterTurbo → MODO: isolated evaluation

Status: research only. No production integration, deployment, paid generation, or changes to the existing Creative Engine.

Upstream: https://github.com/harry0703/MoneyPrinterTurbo

## Objective
Evaluate a low-cost short-video assembly backend for MODO, complementary to the existing premium Higgsfield video provider. The MODO Creative Engine remains the system of record for brand context, job ownership, approval, quality gate and distribution.

## Proposed boundary
- Dedicated Python worker/container (not inside the current Node API process).
- Internal authenticated adapter only; no browser access to worker or provider keys.
- MODO job → approved brand brief and owned/licensed assets → isolated render worker → immutable HTTPS video asset → existing Quality Gate → explicit customer approval → publishing.
- Separate per-tenant workspace, quotas, request IDs, bounded retries, concurrency limits, timeout and retention policy.
- No automatic publishing, paid model calls or third-party footage retrieval in the initial evaluation.

## Proof-of-concept acceptance criteria
1. Generate one 15–30s 9:16 video using supplied test assets and a Brazilian Portuguese script; subtitles and narration aligned.
2. Export HTTPS MP4 (not base64/data URI); check duration, audio, dimensions, file size and playback.
3. Verify that brand assets and output are tenant-isolated and cleaned up after the retention period.
4. Measure CPU/RAM, processing time, cost per completed video and failure/retry behavior.
5. Confirm upstream repository license and the separate licensing/usage rights for bundled music, fonts, voices and stock footage. Replace unverified bundled assets.
6. Confirm API request/response contracts against a pinned upstream revision; do not assume endpoints.
7. Fail closed when worker unavailable. Preserve the existing image/Higgsfield routing and approval flows.

## Explicit non-goals
- No clone of upstream source into MODO until licensing/security review.
- No Render paid service or new infrastructure provisioned automatically.
- No secrets committed to GitHub.
- No default route switch, production launch, or claims that PT-BR quality is proven.

## Decision
Proceed only after a reproducible local/isolated smoke test and documented license, cost, security and quality evidence. Until then this is a candidate provider, not an enabled feature.

## Verified upstream facts (12 Oct 2026)
- Upstream LICENSE is MIT; copyright attribution and license notice must be retained.
- Upstream provides a Dockerfile, docker-compose.yml and FastAPI dependencies (fastapi/uvicorn). The compose example bind-mounts the source and publishes the API port; do not deploy this example unchanged as a public production endpoint.
- Dockerfile uses chmod 777 on the application directory: harden filesystem permissions, runtime user and volumes before deploying.
- Requirements include FFmpeg-oriented media stack, moviepy, faster-whisper, edge-tts and cloud SDKs; CPU/RAM and transitive-dependency review are mandatory.
- The repo license does NOT grant rights to third-party music, stock media, fonts, voices or provider content.

## Deployment gate
Do not provision a public upstream container with unauthenticated rendering endpoints. First implement a dedicated MODO-side authenticated proxy and tenant/job-level authorization, and pin a vetted upstream revision. Use a private network endpoint where available, non-root container, strict request validation, limits and explicit output storage. Do not use the existing production API's environment secrets in the worker. Start with an isolated no-spend smoke test. No production rollout before verified video output and security tests.
