# MODO HyperFrames: durable synthetic nonce proof

State: PR #164 DRAFT, **synthetic data only**. Nothing deployed or enabled for customers.

The protected 005_synthetic_handoff_nonces.sql migration must be applied MANUALLY to the disposable, isolated PostgreSQL database named modo_hyperframes_staging, after migrations 001-004. It is NOT added to the local Compose template and never runs against production. Global nonce UUID PRIMARY KEY stops replay even across tenants; constraints require synthetic-only identities and <=60 second expiry. Claims are never deleted in this lab, so expiration does not authorize replay.

The trusted-side static-handoff-pg-nonce.mjs uses database clock_timestamp(), a single atomic INSERT ... ON CONFLICT DO NOTHING RETURNING 1, DB name verification and explicit test-only environment switches. Identifiers and order digests are captured from independently authorized scheduler metadata. The Node adapter is **not** bundled into the separate renderer/browser image.

Dedicated hf_staging_nonce_dispatcher role is NOLOGIN and INSERT-only, without credentials. Existing hf_staging_worker receives no nonce privileges. Tests run in the existing disposable PostgreSQL GitHub workflow and exercise durable reuse across pools, 20 concurrent signed requests, cross-tenant reuse, expiry, wrong database, forbidden environment and role grants.

This does NOT integrate with the real render_jobs queue/lease/fencing, support authenticated service communications, rotate keys, perform audit/retention policy or sign real MP4 results. Production remains blocked. The original HyperFrames CLI restricted-Docker failure remains an independent gate.
