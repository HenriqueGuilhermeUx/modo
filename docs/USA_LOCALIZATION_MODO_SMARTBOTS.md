# MODO / SmartBots — US localization preview

**Branch:** `feature/usa-modo-smartbots-localization-20261024`  
**Region:** United States / English (en-US)  
**Release gate:** Not approved; isolated preview only. No production deployment.

## Visible routes
- `/us`: English-language MODO capabilities page
- `/us/smartbots`: English-language SmartBots assisted capabilities page

Both pages explain that US onboarding, billing, provider integrations, and contracts are not yet available. They intentionally do **not** send leads to Brazilian plan checkout or claim new SMS/voice automation. Do not promote these pages as live US offerings before verification.

## Non-destructive scope
- Adds isolated lazy-loaded React component + scoped stylesheet, with no Brazil copy, billing, API, auth, database, PWA or default-route replacements.
- Changes page title, description and document language only while the US page is mounted.
- Existing Brazilian `/`, `/app`, `/smartbots`, and `/smartbots.html` continue their old routing unchanged.
- Existing SmartBots assisted flow uses manual WhatsApp send; the US preview states this transparently.

## QA requirements before release
- [ ] Run `npm run build` (or workspace package manager) and review TypeScript errors.
- [ ] Verify `/us` and `/us/smartbots` at mobile and desktop widths.
- [ ] Confirm `/`, `/app`, `/smartbots.html`, `/app/smartbots` still behave as before.
- [ ] Review marketing claims against deployed features.
- [ ] Review US terms, privacy, accessibility, data collection and billing separately.
- [ ] Implement true en-US product UI, support, price selection and localized activation only after region-specific backend entitlement checks.
- [ ] Arrange legal and commercial signoff.

## Operational demonstrators added (2026-10-25)

- `/us/demo`: MODO English campaign brief + reviewable, rule-based checklist and copy-to-clipboard draft. This is **not** an AI generation request or an activated marketing account.
- `/us/smartbots/demo`: SmartBots English lead inbox with fictional sample contacts, local stage changes, local sample lead creation and manual copy of follow-up drafts. No SMS, WhatsApp, email or backend calls.
- Both demonstrate interface workflows using temporary React state only. Visitors must not enter real customer data; refresh discards all changes.
- US landing pages link to the demonstrators. No conversion to Brazilian checkout or `/app` routes.

Next work: true authenticated en-US tenant separation, backend/campaign settings, US legal policies, accessible UI and translations across full existing product modules. Those remain **not completed**.
