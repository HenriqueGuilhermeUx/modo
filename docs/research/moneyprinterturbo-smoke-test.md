# MoneyPrinterTurbo isolated smoke-test runbook

This is an opt-in local/private test. It does not change the MODO production API, frontend or creative routing.

## Verified upstream contract
- Source: https://github.com/harry0703/MoneyPrinterTurbo
- License: MIT (preserve copyright notice)
- Runtime: Python 3.11+, FFmpeg, MoviePy, FastAPI and voice/stock-media integrations.
- Upstream `config.example.toml` uses `[app] api_key` and **`x-api-key` header**, NOT Bearer auth. This also protects files under `/tasks`.
- The upstream compose file binds API port 8080 to 127.0.0.1 and mounts the repo into the container. Keep it loopback-only for evaluation.

## Operator procedure (private host with Docker)
1. Clone a reviewed/pinned upstream revision into a dedicated directory; inspect the Dockerfile and dependency lockfile.
2. Copy `config.example.toml` to untracked `config.toml`. Set `[app].api_key` to a unique random secret, `listen_host` to `0.0.0.0` inside the container, `max_concurrent_tasks=1` and `max_queued_tasks=1` if supported by the pinned revision.
3. Ensure the compose API binding stays `127.0.0.1:8080:8080`; disable WebUI in the test deployment. Restrict outbound traffic and limit CPU/memory/disk. Avoid mounting production credentials.
4. Run `docker compose up --build api` only on the isolated host. Observe startup and readiness, then use the upstream API docs at `http://127.0.0.1:8080/docs` **from that host** to verify the pinned task request schema.
5. Use a dedicated PT-BR test script and only licensed user-supplied media. Set video dimensions 1080x1920, target 15–30 seconds, and inspect generated audio/subtitles. No production brand data.
6. Save timing, RAM peak, disk use, provider charges, audio intelligibility and output checks. Do not enable MODO routing until approved.

## Production hardening requirements
- Do not expose upstream port 8080 publicly. A private network and authenticated MODO-side adapter are required.
- Validate tenant membership and job ownership on every create/status/download; use a dedicated API key per deployment, never return it to the browser.
- Do not treat `/api/v1` connectivity as proof of authentication; test both rejected invalid-key and accepted valid-key requests on a known protected route.
- Store outputs in MODO-controlled object storage, never expose upstream `/tasks` URLs directly.
- Enforce explicit confirmation before any paid provider request, idempotency, quotas and manual approval before publishing.

## Current state
This runbook and connectivity probe are committed on a draft PR. **No isolated worker is deployed yet and no video has been generated.** Do not mark integration complete.
