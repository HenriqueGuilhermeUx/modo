# MODO + SmartBots USA — Netlify launch checklist

Target new Netlify site: `av-usa-modo` (site ID `241772f0-7d68-4ff3-a20d-aeac9bcbb3f8`).

Source: `HenriqueGuilhermeUx/modo`, branch `feature/usa-modo-smartbots-localization-20261024`, PR #163 (DRAFT).

## First publication scope

- **Only** US product previews: `/us`, `/us/smartbots`, `/us/demo`, `/us/smartbots/demo`.
- All US demos are local/synthetic; no real US account activation, payments, backend mutation or automated outbound messages.
- Do not point users to Brazilian `/app`, account signup, admin, billing, or production API flows.
- Require a USA-only route allowlist or separate preview build before making a URL publicly discoverable. A redirect from `/` alone does not prevent direct navigation to BR routes.
- Keep `noindex,nofollow` until market/legal review.

## Backend reuse / cost boundary

Existing Brazilian Render API and data stores must **not** be enabled for USA previews by reusing their env variables. The current root `netlify.toml` includes `VITE_API_URL` for the Brazilian MODO backend; this must be overridden or excluded from an isolated USA build, and runtime access must be constrained. Shared code can be reused, but shared patient/client/company data requires independently verified tenant and region controls.

A later USA operational API can use a shared deployment only after: tenant authorization, regional data separation, rate limits, abuse controls, CORS, consent, provider contract review, and complete audit tests. Prefer one deployment with explicit per-tenant controls when safe; otherwise use a separate logical boundary. Never copy Brazilian credentials into the frontend.

## Netlify linking (one-time)

1. In new project `av-usa-modo`, connect GitHub repo `HenriqueGuilhermeUx/modo` and select the isolated USA branch **only after** the USA route allowlist is implemented.
2. Root build uses npm workspaces; repository config publishes `apps/web/dist`. Do not edit the Brazilian Netlify project `modo1`.
3. Run previews, check `/us` and `/us/smartbots` and their demos; test direct access to `/app` and auth/admin paths (must be blocked).
4. Verify browser network panel shows no Brazilian backend requests, no US real checkout, no JS errors; confirm HTTP status/deploy ID and temporary URL before claiming live.
5. Do not add domains or enable client signup until authorization/commercial terms and regional controls pass.

This document does not mean a Netlify deploy has occurred.

## Isolated artifact and root-config collision (2026-10-27)

**Do not connect this new Netlify project to Git with the default repository settings.** The root `netlify.toml` is owned by the Brazilian application. It sets `publish = "apps/web/dist"`, `VITE_API_URL` to the Brazilian API and a wildcard SPA rewrite. Netlify file configuration takes precedence over conflicting build settings in the UI. A Git connection without a verified USA-only package configuration can therefore publish the wrong app.

The isolated branch now builds a **separate, static-only** `apps/web/dist-usa` artifact using:

```sh
npm install --include=dev
npm run build --workspace=@modo/contracts
node scripts/build-usa-netlify.mjs
```

The resulting directory must contain exactly `index.html`, `404.html`, `logo.svg`, `assets/`, `_redirects` and `_headers`. Its allowlist serves `/`, `/us`, `/us/smartbots`, `/us/demo` and `/us/smartbots/demo`; all other routes return a static 404. The `_headers` file sets `connect-src 'none'`, `form-action 'none'`, noindex and restrictive browser permissions. CI verifies the generated artifact, but **only a real Netlify response** can prove the platform honored these headers and the HTTP 404.

Safe first publication path, subject to the owner's explicit test-deploy authorization:

1. Download the `modo-smartbots-usa-netlify` GitHub Actions artifact from the **exact current PR HEAD** and inspect its six top-level entries. Do not publish the repository root, `apps/web/dist`, or a default Brazil build.
2. Upload only the extracted `dist-usa` directory to the separate `av-usa-modo` site using a verified manual deploy mechanism, or first configure and audit a USA-specific Netlify package/build configuration that overrides the Brazilian root settings. Do not change `modo1`.
3. Obtain the **actual Netlify deploy ID**, state `ready`, site ID and immutable deploy URL. Record the artifact SHA/commit provenance. An empty site, a project URL or an existing `modo1` PR preview is not proof that `av-usa-modo` has been deployed.
4. Probe real responses: `/us`, `/us/smartbots`, both demos, direct refresh, `/app`, `/login`, `/admin`, `/api/test`, `/checkout` and an unknown path. Restricted paths must return HTTP 404; successful pages must have noindex and `connect-src 'none'`. Inspect browser requests and verify **zero** Brazilian API calls.
5. Keep the project in test-only mode. Do not enable signup, outbound messaging, payment, real providers, domain changes, or production deployment.

As of the 2026-10-27 inspection, the dedicated Netlify project had no published deploy ID. The separate existing `modo1` pull-request preview is not the dedicated USA site.
