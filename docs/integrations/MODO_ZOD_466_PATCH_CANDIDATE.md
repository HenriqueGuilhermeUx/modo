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
