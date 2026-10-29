# MODO — candidate patch: Zod 4.6.6

**Status:** Isolated branch, draft review only. NOT a production patch.

Branch: `security/modo-zod-466-staging-20261026`, based on the open
HyperFrames pilot `feat/hyperframes-pilot-20261025`.
Change: `@modo/api` now requests the **exact** Zod 4.6.6 package,
the first patched release for GitHub advisory
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

GitHub Actions installs this candidate in a disposable runner, audits the
API runtime dependency tree, rejects all remaining `zod` advisories,
verifies the resolved Zod version, and runs TypeScript, unit/integration,
build and Remotion video smoke tests.

The repo has no checked-in `package-lock.json`, so no lockfile was removed
or changed. Reproducible lockfiles should be introduced only after dependency
resolution and the upgrade policy are reviewed.

**Not covered by this patch:** Remotion bundler/studio, Expo, node-forge,
Vitest/tinypool, provider network policies or runtime reachability.
The entire MODO release remains blocked until these are reviewed separately.
The pilot and production deployments, users, assets, publishing,
billing, and PR #164 remain unchanged by this candidate.


## Verified candidate results — 2026-10-26

An initial experiment with only the direct API Zod pin **failed**:
`npm audit` found a second vulnerable copy at
`node_modules/@remotion/studio/node_modules/zod`.

A narrowly scoped root package override was then added:
`overrides["@remotion/studio"].zod = "4.6.6"`.

The corrected candidate **passed**:
- API `npm audit --omit=dev --workspace=@modo/api`: **0 critical,
  0 high, 0 moderate** (previous baseline was 0 critical / 3 high).
- Direct API Zod resolves to `4.6.6`.
- All-workspace TypeScript type checks.
- API unit/integration test suite.
- Full build of API and web packages.
- Existing Remotion V1.8 video-render smoke, including valid MP4,
  narration, soundtrack and Media Lab.
- GitGuardian security check.

Evidence: https://github.com/HenriqueGuilhermeUx/modo/actions/runs/40353332576/job/121679024031

**This does not certify the transitive override against every possible
Remotion Studio path**, nor security of the deployed API container.
A dedicated staging replay and careful code review remain required.
No production deployment, merge or customer operation occurred.
The mobile Expo-related high-severity findings remain unresolved.
