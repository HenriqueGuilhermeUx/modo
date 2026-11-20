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
