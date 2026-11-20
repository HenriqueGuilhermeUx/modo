# HyperFrames 015 — host-controlled renewal DURING signed Chrome/FFmpeg render

**MODO synthetic-only PR #164 DRAFT. This is not authorization for production or customer media.**

## What changed

The prior full real H264 test renewed the same job **after** Chrome had already completed. This increment moves that renewal into the active rendering interval. The isolated host supervisor `static-live-host-lease-supervisor.mjs` starts in the GitHub Actions runner in parallel with the authorized one-shot Chrome Docker process. The supervisor, never the browser, reads the trusted preflight identity and broker one-shot launch confirmation; validates the original queue job, tenant, worker, fence, version and digest; refuses a renderer process that has exited or a video already present; and atomically renews via `renew_synthetic_lease_epoch` under `SET LOCAL ROLE hf_staging_nonce_dispatcher`. It checks the host renderer process is still alive after renewal.

The renewal is **event-triggered and single-use**, not an unbounded periodic heartbeat: the existing PostgreSQL 010 function caps each renewal at 60 seconds, at most two epochs per job and a total 120-second horizon since one-shot launch. This increment performs only **one** active-render epoch, with at most 20 seconds to observe the trusted broker launch. Failed checks abort the workflow. The renderer does not obtain database credentials or private Ed25519 keys.

The independent real-MP4 E2E `static-real-renewed-v3-mp4-e2e.mjs` no longer renews after rendering. It requires the host-generated live proof and independently fetched PostgreSQL epoch with `from_version` equal to the signed original version. After checking real H264 codec/dimensions/150 frames/temporal hashes, the host signs v3 continuation and output receipts and stores actual rendered bytes atomically in AES-256-GCM, with read-after-restart verification. No customer publishing.

## Safety and verification

The disposable PostgreSQL suite adds tests for current-version-only renewal, ten simultaneous attempts (exactly one success), dead renderer denial, tampered launch confirmation and refusal when output exists. The new live workflow verifies both process exit codes and the signed job's stored epoch before issuing v3 receipts. The original non-renewed MP4 E2E remains a separate regression gate.

**Still not production ready:** no automatic policy for arbitrary-duration renders, no sandbox safe for untrusted browser assets, no full Remotion animation/audio parity, and no crash-safe cross-host orchestration. Browser `--no-sandbox` remains confined to isolated synthetic CI. Do not merge/deploy or supply user media.
