# MODO HyperFrames one-shot staging worker

This module has **no HTTP route, no queue consumer, no publisher, no database or
storage integration**. It cannot be reached by users. Call the pure
renderHyperframesStagingPreview only in an isolated, disposable worker process.

Preconditions:
- MODO_HYPERFRAMES_WORKER_MODE=isolated-staging, NODE_ENV not production.
- Separate image with preinstalled, pinned HyperFrames executable and ffprobe,
  referred to by absolute file paths (no npx download during a render).
- All input must be tenant-authorized and synthetic or approved for staging.
  Existing media, audio, animations and incompatible timing are rejected.
- Resource/memory/network/container controls must be enforced by the worker
  infrastructure, not by this JavaScript module.
- Output is returned in memory only with SHA-256; never written to customer
  object storage or scheduled/published.
- No credentials, tokens or secret environment variables forwarded to child processes.
- Job timeout is 120 seconds; maximum video output 25 MB. Video metadata
  is verified with ffprobe; sandbox smoke validates non-identical scenes.
- One-shot temp workdir is removed on success or failure.

This is an intermediate step toward a durable, tenant-scoped queue + storage
and a preview UI. Do not enable it in Render/Netlify production.


## Tenant-scoped worker gate

Every call must now include an `authorizedOrganizationId` independently
verified by the future scheduling service; it must equal
`project.organizationId`. Cross-tenant jobs fail before creating files or
starting any subprocess. The caller cannot supply this value from an untrusted
queue payload or browser request. Unit tests cover a mismatched organization.
