# HyperFrames: synthetic scheduler handoff and signed receipt

Status: experimental only. PR #164 DRAFT; no deployment, real tenants, billing, private credentials, production APIs or integration with the existing Chrome renderer.

This increment implements a trusted-side Node 22 Ed25519 contract prototype outside the browser image. A scheduler-signed order binds synthetic tenant, project, job, worker, project SHA-256, render-order SHA-256, nonce UUID and a short expiration (up to 60 seconds). A trusted authorization record must independently supply those identifiers and digests. Unknown or revoked keys, invalid signatures, expired orders and field mismatches are denied.

The verifier requires an injected consumeNonce(tenantId,nonce,expiresAtMs) callback. Tests cover sequential and parallel replay with an in-memory Set; this is NOT durable replay prevention. Before operational use, a trusted scheduler/worker must implement an atomic unique claim in isolated PostgreSQL with scoped authorization, lease/fencing, expiry cleanup, audit logging, idempotency, revocation and key rotation. No database credentials may be passed to the browser image.

A separate worker-signed receipt binds the request digest, original render-order digest, worker identity, job, media hash, expected codec, size, frame rate and frame count. Acceptance requires an independently computed output media SHA-256. The present unit tests use fake bytes rather than a real MP4; integration with the existing 150-frame synthetic video proof remains future work.

Test runner: .github/workflows/hyperframes-synthetic-handoff-contract-ci.yml. Production mode and non-synthetic execution are explicitly refused.

Still blocked: real persistent replay guard, scheduler/renderer service authentication, linkage to PostgreSQL lease/fence, independent output hashing of actual MP4, Remotion visual fidelity tests, security review of Chrome --no-sandbox and the original CLI failure (Network.enable timed out). The standalone renderer is NOT imported or modified here. This contract cannot authorize live rendering or publishing.
