# MODO API security remediation — Zod and Remotion

Date: 2026-10-26. **Isolated, draft PR #167 targeting the MODO
HyperFrames draft PR #164. No production deployment or merge.**

## Findings verified in GitHub Actions

| Scenario | Typecheck + build + tests | Runtime API critical/high |
|---|---|---|
| Original Remotion 4.0.516 and old transitive Zod | Baseline passed | 0 critical / 3 high |
| Trial Remotion 4.0.539 + direct Zod 4.6.7 | 130 tests passed | 0 critical / **8 high** |
| Remotion 4.0.516 + direct Zod 4.6.7 | 130 tests passed | 0 critical / **3 high** |
| Original Remotion + direct Zod 4.6.7 + scoped override for Studio | 130 tests passed | **0 critical / 0 high** |

The failed Remotion 4.0.539 trial introduced five additional vulnerable
transitive Remotion packages in the API audit scope. **Do not advance this
upgrade without a clean independent audit.** It was reverted.

## Safe Zod remediation experiment

- API direct Zod dependency is exactly `4.6.7`.
- Root `overrides` targets only `@remotion/studio -> zod:4.6.7`.
- Original Remotion, bundler and renderer remain exactly `4.0.516`.
- Previously resolved copies were `@remotion/studio/node_modules/zod@4.4.3`
  and `expo/node_modules/zod@3.25.76`. Only Studio's nested dependency
  is eligible for the override; **Expo is intentionally untouched**.
- GitHub Actions resolved the candidate in an isolated runner, built,
  typechecked, passed 130 tests and audited **zero high/critical API
  runtime findings**. Actual infrastructure deployed with a different
  dependency graph is not yet scanned.

## Lockfile/release gate

The workflow generates a complete package-lock.json in the disposable
runner and uploads it as a short-retention artifact, instead of
automatically committing dependency changes. The reviewed lockfile has
964 package entries and the expected package versions:

- `node_modules/zod: 4.6.7`
- `node_modules/@remotion/bundler: 4.0.516`
- `node_modules/@remotion/studio: 4.0.516`
- `node_modules/expo/node_modules/zod: 3.25.76`
- no vulnerable nested Studio Zod copy.

**Still required before merging this draft PR:** review and commit the
generated lockfile in this isolated branch, run reproducible `npm ci`,
repeat scoped npm audit, inspect production lock/image reachability,
verify tenant isolation, permissions, publish and media tests, and repeat
synthetic 15s MP4 rendering. The mobile Expo audit remains separate.

No production code, API route, Render, Netlify, customer data, budgets,
scheduling or transactions were changed. Do not enable HyperFrames or
merge the branch based on this document alone.
