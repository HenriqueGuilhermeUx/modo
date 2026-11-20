# MODO — fluxo de solicitação de exclusão de conta (pré-TestFlight)

Data: 19/11/2026. Branch isolada `chore/ios-appstore-readiness-20261109` / PR #172. **Nenhum deploy em produção autorizado nesta etapa.**

## O que foi implementado

- Na aba nativa **Conta**, depois de uma confirmação explícita, o app chama `POST /api/v1/auth/account-deletion-requests` com token Bearer da sessão já autenticada.
- O endpoint usa `AuthService.authenticate` e grava `modo_account_deletion_requests` em PostgreSQL, com `user_id`, `organization_id`, `status=pending`, `created_at` e identificador UUID; não replica nome ou email na tabela. Rate limit: até 3 chamadas/hora por cliente.
- Há índice único parcial por `user_id` para pedidos `pending`; solicitações repetidas recebem o mesmo protocolo e não disparam exclusão.
- O app só confirma o protocolo depois que o servidor retorna `202 Accepted`. Em erro de API, deixa claro que nada foi registrado e mantém as instruções públicas e contato de suporte acessíveis.
- Teste automatizado no modo de memória cobre primeira solicitação, idempotência e isolamento entre usuários. A implantação real em PostgreSQL exige teste de staging separado.

## Contrato de API

`POST /api/v1/auth/account-deletion-requests`

Header: `Authorization: Bearer <session>`

Resposta autenticada: `202 { "requestId": "...", "status": "pending", "createdAt": "ISO timestamp" }`

Sem autenticação: erro 401. **Não é endpoint de apagamento e não executa exclusão de contas.**

## Procedimento operacional antes de habilitar em produção

1. Validar com o responsável jurídico/privacidade a identidade do controlador e a política de retenção. Definir responsáveis pela fila de solicitações.
2. Em banco isolado de staging, validar criação da tabela, autenticação, isolamento, concorrência, não duplicação e visibilidade do protocolo. Não copiar dados reais nem executar exclusões de teste em produção.
3. Disponibilizar à equipe autorizada procedimento mínimo para acompanhamento seguro dos pedidos `pending`; requer autorização de acesso adequada. Não expor a fila em endpoint público.
4. Definir e testar a **eliminação efetiva** de usuário, organizações, marcas, projetos, arquivos, tokens sociais, assinaturas, prestadores e dependências; comprovar reversão/retenção legal e auditoria por etapa. O serviço atual **não implementa essa eliminação**.
5. Confirmar no iPhone/iPad físico e em simulação: autenticação, confirmação da solicitação, resposta 202, repetição, falha de rede, saída/logout e casos de dois dispositivos.
6. Publicar API compatível antes de distribuir o cliente que chama a rota. Se o cliente chegar antes, o pedido deve falhar sem alegar registro.
7. Inspecionar App Review Guideline 5.1.1(v) e política final com especialista. O aceite da Apple depende do fluxo real, não apenas da existência do botão.

## Segurança e ressalvas

- O pedido pendente é um registro de intenção; **não prova tratamento, conclusão ou exclusão de dados**.
- O armazenamento de tickets não deve ser usado como dado de marketing, e acesso deve ser restrito e auditado.
- Como a implementação está em PR isolado, **nenhuma conta real foi alterada, nenhum usuário foi excluído e nenhum IPA foi enviado**.

## Complemento — leitura do protocolo e fila administrativa (19/11)

- `GET /api/v1/auth/account-deletion-requests/current`: requer sessão Bearer de usuário e retorna `{ request: {requestId,status,createdAt} | null }`, restrito ao `user_id` autenticado. Permite recuperar protocolo depois de fechar e abrir novamente o app.
- `GET /api/v1/admin/privacy/deletion-requests`: requer **token de plataforma admin** já suportado pelo MODO (`admin.authenticate`), e não aceita token comum de cliente. Resposta `{requests: [...]} ` com no máximo 50 solicitações `pending`, em ordem cronológica, incluindo identificadores de operação e contato para tratamento manual. Protegido por rate limit e **somente leitura**, sem endpoint de exclusão/alteração de status.
- A consulta administrativa inclui e-mail do solicitante, dado pessoal: restringir acesso a operadores autorizados, auditar acesso, definir rotina de atendimento e prazo de retenção. Não reutilizar dados para marketing.
- Novo teste PostgreSQL verifica status isolado por usuário e fila pending; a comprovação do CI deve ser anexada quando terminar.

**Não confundir** a fila read-only com um console de tratamento completo. Sem operador responsável e execução auditável da exclusão, o processo permanece parcial. A presença de rota de consulta não dá acesso ao App Store Connect nem autoriza deploy.

## Evidência adicional e auditoria da fila

A suíte de integração ampliada concluiu **SUCCESS, 2 testes**, no runner [#44645863507](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/44645863507), incluindo recuperação da solicitação por outra instância do `AuthService` e visualização na fila read-only de tickets pendentes. O acesso à fila por token administrativo agora registra evento `privacy.deletion_queue_viewed` na tabela interna `modo_admin_audit_log`, sem colocar e-mail de cliente no metadado do evento. Mudança de auditoria: commit `180c279`; CI dessa revisão ainda não validado no momento desta nota.

**Não interpretar o teste de repositório como validação de permissão HTTP ponta a ponta**. Antes de deploy, homologar via API 401 com token ausente/de cliente e 200 com sessão administrativa legítima, com auditoria, limites e retenção da fila. A lista não executa exclusão e não automatiza comunicação com clientes.

## Testes HTTP completos e correção de segurança (19/11/2026)

Incluído teste `apps/api/src/account-deletion-http.test.ts` para executar `createApp` com PostgreSQL 16 efêmero e exercitar as rotas reais via `app.inject`, incluindo: POST sem token (401), GET de status antes/depois (somente do próprio titular), registro (202), token comum tentando acessar fila admin (401), login admin real + leitura pendente e registro auditado sem e-mail pessoal nos metadados. Workflow isolado: `.github/workflows/ios-account-deletion-postgres.yml`.

O primeiro run de homologação [#44652374157](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/44652374157) encontrou **bug de tratamento de exceções**: token de cliente no endpoint admin já era recusado, mas gerava HTTP 500 ao invés de 401 porque `PlatformAdminError` não fazia parte do error handler global da API. Corrigido em [commit `632e7f7`](https://github.com/HenriqueGuilhermeUx/modo/commit/632e7f7d9f1bd0c64b0861e4a92c3e7135490eb3), mapeando a exceção para `statusCode` correto. O novo run [#44652573724](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/44652573724) ainda aguardava conclusão nesta anotação.

Preflight nativo anterior [#44646136159](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/44646136159) compilou e lançou no iPhone, e conseguiu gravar screenshot, mas a etapa foi marcada FAIL por **timeout de 12 minutos**, depois da captura, durante teardown lento do simulador. Atualizado workflow em `8a457e6` para dar 18 minutos e não bloquear a aprovação depois da captura em `simctl terminate/shutdown`, ainda exigindo os resultados de iPhone e iPad. Isso não comprova o preflight nativo do novo commit enquanto não houver SUCCESS.

**Pendente:** finalizar HTTP/auth CI corrigido, simulador iOS mais novo, homologaçao de exclusão efetiva/operacional, Apple Developer/ASC/signing. Nenhum merge, deploy ou dados reais afetados.

## Reconhecimento operacional sem exclusão automática — 19/11

Foi implementada a ação autenticada **`POST /api/v1/admin/privacy/deletion-requests/:id/start-review`**:
- Exige **sessão de plataforma admin** e identificador UUID validado; cliente comum recebe 401, ID malformado recebe 400.
- Registra `review_started_at` em `modo_account_deletion_requests` por `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, de forma aditiva. A listagem já inclui o horário de início da análise.
- Na **mesma transação PostgreSQL**, grava o evento `privacy.deletion_review_started` em `modo_admin_audit_log` sem e-mail, nome ou conteúdo do cliente. Repetições devolvem o mesmo horário e não duplicam evento de auditoria.
- O status do pedido continua `pending`: **não marca como concluído**, não altera permissões do usuário, não executa eliminação e não envia e-mail. Fila operacional ainda requer atendimento humano e procedimento de conclusão validado.
- O teste HTTP passou a conferir a ação, a idempotência, a unicidade do evento e a permanência da conta. Workflow [#44653221323](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/44653221323); resultado a confirmar.

**Não implantar sem preparar operador responsável**, revisar política de retenção e validar fim-a-fim em staging; produção segue intocada.

## Prévia de impacto não destrutiva para o operador — 19/11

Endpoint: `GET /api/v1/admin/privacy/deletion-requests/:id/impact-preview`, disponível exclusivamente com sessão de plataforma admin, UUID válido e limite de taxa. O endpoint não retorna o conteúdo de arquivos ou informações financeiras; devolve somente **contagens agregadas** relacionadas ao titular e à organização:
- Vínculos do usuário e número de membros da organização (detectar compartilhamento com outros titulares);
- Sessões, marcas, solicitações de conteúdo e ativos de conteúdo;
- Assinaturas e lançamentos de créditos;
- Eventos de ativação vinculados ao usuário ou organização.

Cada consulta gera evento `privacy.deletion_impact_previewed` em auditoria administrativa sem e-mail do cliente no metadado. O retorno sempre declara `completeDataInventory: false` e `safeToDeleteAutomatically: false`, além de bloqueios expressos para dados de terceiros e fornecedores, retenções legais e verificação de identidade. O endpoint **não altera nem apaga registros**, não produz parecer jurídico e **não é uma varredura completa** do banco; tabelas de integrações, pagamentos, OAuth, provedores de mídia, armazenamento remoto, backups e outros sistemas precisam de inventário separado.

Validação adicional: `apps/api/src/account-deletion-http.test.ts` verifica a resposta 401 a usuário comum, 400 para identificador inválido, 200 para admin, existência das contagens, auditoria e a permanência do status `pending`. Workflow de integração no PostgreSQL isolado: [#44654992312](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/44654992312) (confirmar conclusão antes de afirmar aprovado).

**Próximo bloqueio de operação:** definir instruções específicas para exclusão real por fonte de dados e retenção necessária; não automatizar deletes por FK/cascata, sobretudo em organizações com múltiplos membros e histórico financeiro. Exigir revisão de terceiros e procedimento controlado de conclusão e confirmação ao titular.

## Matriz de decisão por tabela — 19/11/2026

A auditoria read-only `scripts/privacy/audit-deletion-dependencies.mjs` agora gera **dois artefatos**:
- `tmp/modo-privacy-source-inventory.json`: nomes de tabelas e referências externas identificadas no código;
- `tmp/modo-privacy-table-review-matrix.csv`: **uma linha por tabela**, com arquivo(s) de origem, categoria heurística, classe de revisão obrigatória, indicador de organização compartilhada, necessidade de examinar provedores externos, prazo de retenção e base legal.

**Evidência:** [CI #44659689678 — SUCCESS](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/44659689678) e [artefato #14595450445](https://github.com/HenriqueGuilhermeUx/modo/actions/runs/44659689678/artifacts/14595450445). Foram detectados **58 nomes de tabelas em 223 arquivos**, com 11 tabelas críticas previamente conhecidas presentes. O arquivo CSV integra o mesmo ZIP do relatório JSON.

A classificação em `inferredDomain` é uma regra de nomes, **não uma avaliação jurídica**. Cada linha exige `action=REVIEW_REQUIRED`, `retentionPeriod=UNDETERMINED`, `lawfulBasis=UNDETERMINED`, `externalProcessorVerified=NO`, `sharedOrganizationSafe=UNVERIFIED` e `deletionAutomationAllowed=NO`. O gerador falha se algum registro for alterado para aparentar aprovação automática antes de revisão.

### Aprovação necessária por conjunto de dados

1. **Identidade e titularidade:** distinguir remoção de acesso de usuário individual de exclusão de organização compartilhada, verificando outros membros, múltiplos vínculos e sessões.
2. **Financeiro e pagamentos:** validar registros exigidos por obrigações legais, conciliação, estornos e provedores de pagamento antes de definir anonimização, exclusão ou retenção.
3. **Conteúdo e mídia:** verificar arquivos públicos, históricos de geração, links e ativos remotos antes de qualquer ação.
4. **Integrações e credenciais:** inventariar tokens, OAuth, redes sociais, webhooks, automações e provedores externos; planejar revogação e execução com confirmação.
5. **Auditoria, segurança e backups:** estabelecer políticas de retenção mínima, acesso restrito, restauração e eventual reintrodução de dados por backup.

**Nenhuma política, prazo ou base legal foram presumidos.** A matriz não inspeciona tabelas efetivamente existentes no PostgreSQL nem dados em plataformas externas. Não existe endpoint de exclusão de conta que utilize a matriz para executar `DELETE`.
