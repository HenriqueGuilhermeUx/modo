# MODO Mobile — trial de atualização de manutenção Expo SDK 57

**26/10/2026 — desenvolvimento exclusivamente em branch isolada, PR draft,
sem merge ou deploy.** O objetivo é corrigir as vulnerabilidades do mobile sem
interferir na correção da API (PR #167) nem no HyperFrames (PR #164).

## Dependências e compatibilidade

- Tentativa inicial: alterar apenas `expo` de `~57.0.9` para `~57.0.31`.
  Trata-se da mesma família de SDK; não subir para Expo SDK 58, nem alterar
  React Native 0.86.3 ou React 19.2.3 sem testes próprios.
- As versões de outros módulos Expo continuam como estavam na PR #167.
- A CI instala uma árvore descartável, roda `npm ci` a partir do lockfile
  **temporário**, TypeScript, Expo install --check, checa os identificadores
  Android/iOS e audita somente dependências de execução do workspace mobile.
- Qualquer `npm audit` alto/crítico restante faz o gate `security-release-gate`
  **falhar propositalmente**. O relatório de análise não é uma aprovação.
- O lockfile da PR #167 permanece intacto; nenhum arquivo gerado é commitado
  automaticamente nesta frente.

## Vulnerabilidades de referência — revalidar na candidata

| Pacote | Severidade inicial | Investigação |
|---|---|---|
| `@expo/cli` | Alta | Ferramenta de build e comandos de desenvolvimento; confirmar contexto e dependentes |
| `@expo/code-signing-certificates` | Alta | Ferramenta de certificado/assinatura; tratar como potencialmente sensível |
| `expo` | Alta | Agregação transitiva; identificar dependências concretas |
| `node-forge` | Alta | GHSA-86w9-cpqp-85rv; aviso oficial indica sem versão corrigida publicada até a consulta |
| `zod` | Alta | GHSA-mrhx-c7xc-m3w5; Zod 3 transitivo do Expo não pode ser substituído cegamente por 4 |
| `decode-uri-component` | Moderada | GHSA-vcc3-ghjq-m6fr; versão 0.5.0 declarada corrigida |
| `expo-router` | Moderada | Roteamento: atualização fora do SDK exigirá compatibilidade |
| `query-string` | Moderada | Investigar atualização compatível e o caminho transitivo |

Referências:
- https://github.com/advisories/GHSA-86w9-cpqp-85rv
- https://github.com/advisories/GHSA-vcc3-ghjq-m6fr
- https://expo.dev/changelog/sdk-57

## Requisitos de liberação

1. Identificar exatamente a origem das dependências transitivas, os avisos e
   quais componentes entram no binário em comparação ao build CLI.
2. Corrigir cada vulnerabilidade alta/crítica ou aplicar mitigação auditada,
   documentada, limitada no tempo e aprovada pelo responsável de segurança.
   **Não existe permissão automática para aceitar risco alto.**
3. Registrar lockfile reprodutível no Git e executar nova CI com `npm ci`
   sobre **o arquivo efetivamente versionado**.
4. Validar builds Android/iOS, autenticação, restauração de sessão,
   armazenamento seguro, rotas, atualizações e assinatura.
5. Verificar que produção e credenciais continuam intactas antes de qualquer
   publicação, que depende de autorização separada.

Nenhum aplicativo foi construído para distribuição; nenhuma publicação
Play Store/TestFlight, atualização OTA, alteração de `app.json`,
`eas.json` ou configuração de conta ocorreu nesta trial.

## Resultado de inspeção estática do lockfile herdado

O lockfile base da API PR #167 **já continha** `expo@57.0.31` resolvido,
porque o manifesto antigo `~57.0.9` permitia qualquer correção 57.0.x.
Também continha `node-forge@1.4.0`, `@expo/cli@57.0.32`,
`expo-router@57.0.29` e `expo/node_modules/zod@3.25.76`.

**Assim, elevar o mínimo no manifesto para `~57.0.31` não é, por si só,
uma correção comprovada de qualquer alerta.** O npm audit da nova instalação
é necessário; não remover o bloqueio só por atualizar a versão declarada.

O node-forge observado pertence ao grafo de ferramentas do Expo, mas a
ausência de exploração no binário ainda não foi demonstrada. Confirmar
seus pontos de uso antes de qualquer mitigação; não aceitar automaticamente
o risco de certificação/assinatura nem executar código de patch não revisado.


## Static build-signing and OTA configuration gate (26/10/2026)

Added `scripts/modo-mobile-signing-surface.cjs` and negative tests to fail
closed if this mobile app accidentally enables signed OTA updates, points
Expo updates to an unreviewed remote URL, relaxes cleartext/network safety,
changes the current Android/iOS identifiers, injects sensitive variables
into `EXPO_PUBLIC_*` build environment, or changes Android submission
status away from `draft`.

The new independent `mobile-signing-review` job is a **required input**
of the already fail-closed `security-release-gate`. It emits a short-retention
configuration-only report, no app bundle, certificates, signing keys or secrets.

Important limitations: this is a **static repository config review**, not
inspection of Expo/EAS provider state, signing keys, device binaries,
Expo CLI's native certificate logic, Android Play signing, or cryptographic
exploitability. A green check **does not** waive the node-forge GHSA or
authorize a release. The original mobile dependency audit stays BLOCKED
until all high/critical findings have been remediated or formally reviewed
with a separate decision.


## Fail-closed static bundle screening (26/10/2026)

The Android JS export inspector now **fails its job** (exit code 2)
if it finds a literal reference to `node-forge`, `forge.rsa`, or
`@expo/code-signing-certificates` in the exported application JavaScript.
A unit test launches the CLI with a deliberately suspicious synthetic
bundle, verifies rejection, and checks that a short diagnostic report
survives. CI uploads the report even when such inspection fails; it never
publishes or uploads app JavaScript, signing keys, Expo credentials or
Android binaries.

This detection is conservative but incomplete: minification, source
transformations, indirect crypto dependencies and native binaries may
evade string searches. Absence of matches does not clear the node-forge
advisory, and `security-release-gate` must continue failing while
any high/critical dependency finding remains.
