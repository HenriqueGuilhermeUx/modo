# HyperFrames — Synthetic 30fps Temporal Motion V1

**Scope:** MODO HyperFrames PR #164 DRAFT, staging PostgreSQL `modo_hyperframes_staging`, three signed fictional text scenes only. Do not merge, publish, deploy, run on client video, or replace Remotion.

## What this increment does

The independent renderer previously repeated the same PNG throughout each scene. The fixed module `static-temporal-zoompan-synthetic.cjs` now generates a strictly bounded FFmpeg `zoompan` graph to create real frame-dependent **camera motion** from each of the three independently authorized and already-rendered stills. It emits exactly 31 + 64 + 55 = 150 H.264 frames, with `fps=30`, `d=1`, `trim=end_frame` and `setpts` preserving every original scene boundary. Zoom is capped at **1.028**, increment per source frame 0.0006. The FFmpeg expression is constructed from numeric signed frame boundaries; no tenant text, media path, HTML or user CSS is interpolated.

The same mandatory safeguards remain: signed Ed25519 storyboard, per-render signed scheduler admission, rootless Chrome with strict outer Docker limits, broker challenge with pinned public key, single-use PostgreSQL launcher/fencing, real H.264 verification, Ed25519 output receipt and transactional AES-256-GCM ciphertext. The independent Chrome still has no DB password, secret signing key or publisher.

The real-MP4 E2E now also independently decodes nine frames (0, 15, 30; 31, 63, 94; 95, 122, 149) from the generated MP4 using FFmpeg `framemd5`. It demands **at least two different pixel hashes inside each scene**; this proves in-scene motion rather than just changes between three static images. Original codec, frame count, dimensions, timestamp and content-hash validations are unchanged. Any unexpected behavior fails closed.

## Boundaries, including lease safety

This is **not** equivalence with Remotion's per-layer animated text, entry/exit transitions, pulsing glow, dynamic progress bar or musical soundtrack. The experimental motion moves the entire still by a subtle bounded camera push. SSIM must be remeasured, and can increase or decrease; the audit remains `NOT_VISUALLY_EQUIVALENT`, `releaseAllowed:false`.

The PostgreSQL queue has a 60,000 ms lease limit, and the existing Ed25519 admissions / receipt ledger bind to an exact lease `version` and `fence`. Calling current `heartbeat()` increments the queue version, which would invalidate those signed fields; therefore **this increment deliberately does not auto-renew the lease or extend the deadline**. Browser and FFmpeg executions remain bounded, and a late output is rejected during the signed receipt + fenced transactional finalization. A later independent protocol increment must add version-aware renewal, trusted re-signing or a compatible lease epoch, with concurrent replay/expiry tests; Chrome itself must never manage the database lease. No relaxation or bypass of the lease was introduced.

This is a laboratory proof of real temporal pixel changes, not production readiness or user-media support.
