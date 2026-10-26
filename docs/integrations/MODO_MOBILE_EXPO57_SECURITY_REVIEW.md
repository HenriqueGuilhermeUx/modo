# MODO Mobile — análise isolada de segurança do Expo SDK 57

**Estado:** experimentação documental e CI em uma branch separada da PR #164.
Sem deploy, alteração de app distribuído, alteração de dependências, merge,
dados de clientes ou execução financeira.

## Evidências auditadas em 26/10/2026

O `npm audit --omit=dev --workspace=@modo/mobile` do snapshot original
encontrou 0 críticos, **5 altos**, 3 moderados:

| Severidade | Pacote | Investigação |
|---|---|---|
| Alta | `@expo/cli` | Dependência transitiva; checar fluxo de build/CLI |
| Alta | `@expo/code-signing-certificates` | Ferramentas de certificação |
| Alta | `expo` | Agrega dependências vulneráveis; não implica vulnerabilidade no bundle JS |
| Alta | `node-forge` | `GHSA-86w9-cpqp-85rv`, nenhuma correção publicada até esta verificação |
| Alta | `zod` | `GHSA-mrhx-c7xc-m3w5`, checar dependência e versão efetivamente incluída |
| Moderada | `expo-router` | Exige upgrade coordenado com SDK e roteamento |
| Moderada | `query-string` | Verificar origens e código realmente importado |
| Moderada | `decode-uri-component` | `GHSA-vcc3-ghjq-m6fr`; revisar parsing de entradas |

A árvore CLI/EAS é diferente do código JavaScript efetivamente entregue
ao Android/iOS. **Um `npm audit --omit=dev` não determina quais módulos
entram no APK/AAB nem prova que uma falha é explorável.** Por isso,
a classificação de bibliotecas é uma hipótese de triagem, não declaração
de segurança ou motivo para ignorar vulnerabilidades.

## Critérios da homologação

- Conservar Expo 57, React Native 0.86 e versões atuais de produção.
- Rodar `npm audit` em runner descartável e preservar IDs GHSA.
- Build de tipos e exportação estática Android sem EAS e sem loja.
- Recolher estatísticas do export, sem publicar bundles ou dados privados.
- Não alegar que a ausência de nomes em sourcemaps demonstra ausência
  de dependências — minificação, Hermes e plugins podem ocultá-las.
- **Bloquear liberação** enquanto houver altos/críticos sem mitigação
  verificada. Conferir pacotes usados em assinatura, certificados e
  distribuição em ambiente confiável antes de criar AAB ou submissão.
- Não aplicar `npm audit fix --force` nem downgrade para SDK 54
  sugerido pelo npm: quebra potencial das APIs SDK 57.
- Não fazer override de `node-forge` para versão não corrigida, nem
  forçar `zod@4` em ferramentas Expo sem testes específicos.

## Próximos controles

Se os alertas estiverem confinados a ferramentas de compilação, avaliar
um runner de build sem segredos persistentes, com egress restrito,
tokens efêmeros e revisão das rotinas de assinatura. Continuar auditoria
até upstream publicar correção ou existir patch upstream validado.

A PR #167 corrige **apenas a API**, não a árvore Expo/mobile.
A PR #172 da Nexa Agentics continua fora do escopo.

## Primeira homologação reproduzida — 26/10/2026

CI [GitHub Actions #40377249984](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/40377249984) concluída com sucesso:

- 3 testes unitários de classificação fail-closed passaram;
- Auditoria de dependências de execução Expo **0 críticos / 5 altos / 3 moderados**, `releaseBlocked=true`;
- Typecheck do workspace mobile e exportação estática **Android** aprovados;
- Bundle Metro compilou **1.355 módulos**;
- Saída técnica de exportação: **30 arquivos**, incluindo um JS e um sourcemap;
- Sourcemap analisado: **1 de 1**, **1.347 entradas de módulos**, nenhuma referência a `node-forge` ou `@expo/code-signing-certificates` nesse mapa;
- O JSON sanitizado marca explicitamente `absenceProvesSafety=false`.
  Não foi criado AAB/APK nativo, não há prova sobre binários embarcados,
  operações de assinatura e ambiente EAS. Também não foram publicados
  mapas de origem; somente estatísticas são fornecidas como artefato.

A ausência das bibliotecas criptográficas no mapa JS **reduz a hipótese
de código enviado pelo Metro**, mas **não elimina a vulnerabilidade**:
o processo de build/assinatura e outros caminhos precisam ser revisados.
A política da PR continua bloqueando a liberação.

Para mitigar risco de assinatura enquanto o upstream não fornece
correção comprovada, um futuro pipeline de build deverá usar identidade
e credenciais efêmeras, mínimos privilégios, runner isolado, sem aceitar
certificados de fontes desconhecidas, além de revisar versões e
integridade antes da distribuição. Nenhuma dessas medidas, sozinha,
torna segura a validação criptográfica vulnerável.
