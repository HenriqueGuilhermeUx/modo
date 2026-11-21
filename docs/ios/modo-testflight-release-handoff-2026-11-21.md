# MODO — liberação TestFlight, checklist verificável (21/11/2026)

> Documento de handoff, não autorização de lançamento. Ramo `chore/ios-appstore-readiness-20261109` / PR #172. **Não usar o perfil de produção antes de satisfazer os gates abaixo**.

## Identidade identificada no código-fonte

| Campo | Valor atual | Evidência |
|---|---|---|
| App | MODO — Presença e Conteúdo | `apps/mobile/app.json` |
| Expo owner | `henrriquenexa` | `apps/mobile/app.json` |
| Expo project | `3ed108b0-91e7-41c4-bb94-fe894183f527` | `apps/mobile/app.json` |
| iOS bundle ID | `br.com.alternativeventures.modo` | `apps/mobile/app.json` |
| iOS version | `1.1.0` | `apps/mobile/app.json` |
| iOS buildNumber | `5` | `apps/mobile/app.json` |
| Backend URL | `https://modo-api-3m10.onrender.com` | `apps/mobile/eas.json` |
| EAS profile | `production`: iOS real device, autoIncrement false | `apps/mobile/eas.json` |
| App Privacy URL | `https://modo1.netlify.app/politica-de-privacidade` | `apps/mobile/app.json` |
| Account deletion URL | `https://modo1.netlify.app/exclusao-de-dados` | `apps/mobile/app.json` |

## Evidências aprovadas — sem credenciais Apple

- [CI geral MODO #44825744632](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/44825744632): SUCCESS na revisão de 21/11.
- [Simulador nativo unsigned #44825744673](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/44825744673): SUCCESS na revisão de 21/11.
- [PostgreSQL integrado #44928072475](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/44928072475): SUCCESS, 4/4 testes.
- [Contrato mobile↔backend #44938168022](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/44938168022): SUCCESS, validação estática do fluxo de exclusão e configuração de build. **Não confundir com validação de disponibilidade real da API.**

## Bloqueios que ainda impedem envio seguro

1. **Backend:** implantar primeiro a API que contém as rotas de exclusão/autenticação, depois validar `401` sem token na rota `GET /api/v1/auth/account-deletion-requests/current`. O diagnóstico HTTP do backend público **não foi comprovado nesta rodada**; não distribuir o cliente novo contra API antiga.
2. **Exclusão de conta:** processo real de execução, retenções e terceiros ainda em análise. O formulário nativo registra protocolo e início de análise, **não elimina a conta**. Confirmar orientação App Review 5.1.1(v) antes de publicação.
3. **Apple:** verificar Team ID vinculado ao titular PJ/conta Apple Developer e se o app `br.com.alternativeventures.modo` existe no App Store Connect. Não criar duplicatas, não converter automaticamente titularidade e não alterar certificados existentes.
4. **Numeração:** checar no App Store Connect se `1.1.0 (5)` já foi usado; incrementar **somente depois** da verificação e antes da build assinada.
5. **Certificados:** comprovar certificado Apple Distribution e provisioning profile válidos para bundle ID e Team aprovados.
6. **Loja:** fornecer App Privacy com classificação efetiva de dados, capturas de iPhone/iPad, suporte, testes em aparelho físico, credenciais de reviewer e contato de privacidade.
7. **Liberação:** após gates aprovados e commit estabilizado, gerar build de distribuição e anexar evidência de upload no App Store Connect. CI unsigned não prova envio.

## Comandos de verificação local — apenas leitura

No repositório MODO e com terminal autenticado pelo operador autorizado:

```powershell
cd apps/mobile
npx eas-cli whoami
npx eas-cli project:info
```

A partir da raiz do repositório:

```powershell
node scripts/ios/check-testflight-config.mjs
node scripts/ios/check-release-contract.mjs
```

**Não executar** `eas build --platform ios --profile production` ou `eas submit --platform ios --profile production` enquanto os bloqueios acima não tiverem evidências de aprovação. A CLI EAS pode solicitar autenticação Apple, criação/renovação de certificados ou permissões; não delegar essas interações de forma silenciosa.

## Registro de liberação

- Team ID Apple: **não verificado**
- App Store Connect app ID: **não verificado**
- Distribuição assinada: **não verificada**
- Backend contendo nova rota: **não verificado em produção**
- Exclusão efetiva: **não implementada**
- Build IPA assinada: **não criada**
- Upload TestFlight: **não realizado**

Atualizar somente com IDs reais das execuções, artefatos e evidências. Não marcar o app como `testflight_ready` antes disso.
