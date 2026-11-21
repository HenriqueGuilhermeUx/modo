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

## Evidências de CI nativo e validação de identidade — 16/11/2026

O projeto Expo MODO já realizou preflight de iOS unsigned em macOS: [CI #42884510627](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/42884510627) **SUCCESS**, com `expo prebuild`, CocoaPods, compilação Xcode, instalação/abertura em simulador iPhone e três artefatos (captura, log, .app). O bundle JS também teve [CI #42884513704](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/42884513704) **SUCCESS**. A afirmação anterior de "workflow not executed" estava desatualizada. Esses runs são evidência da branch anterior, não validam commits posteriores automaticamente.

Commit `13c0b8b` aprimora o workflow de iOS para afirmar no binário compilado `CFBundleIdentifier=br.com.alternativeventures.modo` e inspecionar `UIDeviceFamily` para suporte a iPad, conforme `apps/mobile/app.json` (`supportsTablet:true`). **Isto verifica somente metadados do binário, não instala nem exerce o aplicativo em simulador iPad.** Checar resultado desse novo job antes de marcar o refinamento como PASS.

A configuração Expo/EAS existe em `apps/mobile/eas.json`; nenhum build EAS assinado, IPA distributável, credencial Apple ou submissão foi realizado por esse preflight. Antes de Fase 2: comprovar Play Console/AAB comercial, revisar UX real de iPhone/iPad, login, API e logout, Face ID se usado, privacidade/exclusão, links, App Privacy, conta Apple e dispositivos físicos. Não alterar Android nem produção.
