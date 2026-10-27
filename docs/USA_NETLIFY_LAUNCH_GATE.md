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
