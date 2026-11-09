# MODO — iOS EAS build preparation

The Expo app lives in `apps/mobile` and already declares iOS bundle identifier `br.com.alternativeventures.modo`, Apple build number `5`, EAS project ID, and iOS tablet support.

An EAS configuration has been added under `apps/mobile/eas.json`. These profiles describe **possible** builds and do not trigger them or create signing credentials.

## Workflow (not executed)
1. Confirm existing Expo project ownership and Apple organization membership. Do not re-register or change Bundle ID.
2. Review `apps/mobile/app.json`, privacy policy, account deletion, backend and face ID permission string.
3. From `apps/mobile`: `npx eas-cli build --platform ios --profile preview` for unsigned simulator testing where supported.
4. After native and policy validation, configure signing through an authorized Apple Developer account, then `npx eas-cli build --platform ios --profile production`.
5. Use TestFlight for real-device acceptance; only submit after a verified archive and App Store Connect metadata.

Do not run `eas submit` automatically; no credentials or ASC app association have been verified. Do not change Android configuration.
