# MODO — HyperFrames dependency security review

**Status:** release blocked pending manual vulnerability and reachability review.
**Source:** isolated GitHub Actions `npm audit --json` of the feature branch,
run 2026-10-26 UTC. This is not a scan of a deployed container.

## Initial full-monorepo observations

| Severity | Packages |
|---|---|
| Critical (2) | `vitest`, `tinypool` |
| High (7) | `@expo/cli`, `@expo/code-signing-certificates`, `@remotion/bundler`, `@remotion/studio`, `expo`, `node-forge`, `zod` |
| Moderate (4) | `@vitest/mocker`, `decode-uri-component`, `expo-router`, `query-string` |

The critical findings are associated with test tooling *in the MODO
manifest*, but do not conclude they are absent from deployed runtime
dependencies until a production-scope audit proves that. Conversely, an
alert in a package is not automatically evidence of a remotely exploitable
system vulnerability.

## Workspace separation

`@modo/api` ships Fastify, Remotion bundling, PostgreSQL and other
backend code. `@modo/web` is the React/Vite frontend. `@modo/mobile`
uses Expo/React Native. The next workflow audits all three dependency
sets separately with `--omit=dev --workspace=...`, plus the full repo.

It produces a short-lived sanitized artifact and GitHub job summary
with counts and high/critical runtime candidate blockers. These reports
are input to human release review, not an automatic `npm audit fix`.

## Release gates

1. Obtain exact advisory IDs, vulnerable version ranges and corrected
   versions for all scoped runtime high/critical items.
2. Prove whether the affected code paths are reachable in API production,
   web build or shipped app; verify the exact deployed dependency tree.
3. Upgrade/remediate **in a separate controlled branch** with targeted
   regression tests, avoiding uncontrolled Remotion/Expo/React jumps.
4. Re-run payment, tenant-isolation, first-cut, publisher, media and auth tests,
   as well as the synthetic HyperFrames 15-second MP4 E2E.
5. Review isolated worker sandbox limits, outbound network, temp storage,
   browser permissions, executable pinning and organization authorization.
6. Sign off on staging before any merge, production deploy or feature activation.

No MODO production dependency versions or lockfile were intentionally
changed in this pilot. Existing Render, Netlify, mobile apps, clients and
publisher continue unchanged.
