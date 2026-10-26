# MODO API — independent Zod patch validation

This branch is stacked **on top of** MODO HyperFrames draft PR #164.
It is a **separate draft PR** that changes only the API's direct Zod
version to `4.6.7` and adds disposable CI assurance.

- Advisory: GHSA-mrhx-c7xc-m3w5 (resource exhaustion with
  large Zod collection inputs); releases 4.6.6+ are recorded as fixed.
- API direct dependency is pinned to exactly 4.6.7 to avoid resolution drift.
- The CI audits only API runtime dependencies, verifies that the installed
  Zod version is 4.6.7, and requires Zod to disappear from the
  npm audit runtime findings.
- API tests, typechecks and web typecheck must pass.

This change does not fix Remotion, Expo/mobile, test-tool vulnerabilities
or arbitrary unbounded inputs. HTTP payload limits and explicit
`z.array().max(...)` constraints remain important defenses.
The existing two high Remotion audit findings remain release blockers
unless separately mitigated, fixed and signed off.

The repository currently has no committed package-lock.json; installing
dependencies in CI resolves a fresh graph. This branch does **not**
write lockfiles, update dependency versions outside the API or touch
production. Do not merge without full regression, security and rollout review.

## Transitive package finding and narrowly scoped correction

The first CI pass showed direct API Zod correctly at 4.6.7, but npm audit
still detected `node_modules/@remotion/studio/node_modules/zod` below 4.6.6.

The branch now adds a root npm `overrides` entry for **only**
`@remotion/studio > zod` = 4.6.7. This does not change the pinned
Remotion 4.0.516 versions, nor authorize upgrades of Expo/mobile or Vitest.
The override must be tested with a clean dependency install to establish
whether npm accepts the dependency graph, Remotion's runtime continues
working, and the nested Zod advisory disappears.

The project does not commit a package lock; this test validates the
freshly resolved graph and must be repeated before a real release.
