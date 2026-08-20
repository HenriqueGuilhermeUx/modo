# MODO Publisher Nativo — operação e ativação

## Arquitetura

```text
MODO Web (Netlify)
        ↓
MODO API (Render)
        ↓
PostgreSQL
├── conexões sociais por organização + marca
├── fila de publicações
├── tentativas e falhas
└── snapshots de analytics
        ↓
APIs oficiais
├── Instagram
├── Facebook Pages
├── Threads
└── LinkedIn
        ↓
MODO Learning
```

Nenhuma instalação local é necessária.

## O que já fica automático depois do deploy

- criação das tabelas idempotentes;
- importação da conexão Instagram legada para o novo registro canônico;
- arquivamento automático de novas conexões Instagram por marca;
- worker da fila a cada 30 segundos;
- publicação de agendamentos vencidos;
- retry controlado;
- sincronização de publicações LinkedIn;
- sweep de analytics a cada 6 horas;
- gravação de sinais no MODO Learning.

## Render — variáveis

### Instagram

Já utilizadas em produção:

```env
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
INSTAGRAM_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/instagram/callback
INSTAGRAM_TOKEN_ENCRYPTION_SECRET=
INSTAGRAM_SCOPES=instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights
INSTAGRAM_GRAPH_BASE_URL=https://graph.instagram.com
```

O valor real de `INSTAGRAM_TOKEN_ENCRYPTION_SECRET` nunca deve ir para GitHub, documento, print público ou chat.

### Facebook Pages

```env
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/native-publisher/facebook/callback
FACEBOOK_SCOPES=pages_show_list,pages_read_engagement,pages_manage_posts,read_insights
FACEBOOK_API_VERSION=v26.0
```

`FACEBOOK_APP_ID` e `FACEBOOK_APP_SECRET` podem vir do mesmo aplicativo Meta desde que os produtos/permissões necessários estejam habilitados para o app.

### Threads

```env
THREADS_CLIENT_ID=
THREADS_CLIENT_SECRET=
THREADS_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/native-publisher/threads/callback
THREADS_SCOPES=threads_basic,threads_content_publish,threads_manage_insights
THREADS_GRAPH_BASE_URL=https://graph.threads.net
THREADS_API_VERSION=v1.0
```

### LinkedIn

```env
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/linkedin/callback
LINKEDIN_SCOPES=r_liteprofile w_member_social
LINKEDIN_TOKEN_ENCRYPTION_SECRET=
LINKEDIN_API_VERSION=202606
```

Para a fase atual, usar o mesmo segredo criptográfico forte de `INSTAGRAM_TOKEN_ENCRYPTION_SECRET` em `LINKEDIN_TOKEN_ENCRYPTION_SECRET` mantém o vault social consistente sem expor o valor.

## Health

Abrir:

```text
https://modo-api-3m10.onrender.com/api/v1/native-publisher/health
```

Esperado quando todos os providers estiverem ativados:

```json
{
  "status": "ok",
  "provider": "modo_native",
  "requiresLocalInfrastructure": false,
  "storage": "postgres",
  "scheduling": "enabled",
  "retries": "enabled",
  "analytics": "enabled",
  "learningLoop": "enabled",
  "instagram": { "configured": true },
  "facebook": { "configured": true },
  "threads": { "configured": true },
  "linkedin": { "configured": true }
}
```

## Teste E2E seguro por canal

Usar uma marca de teste e uma conta social controlada.

1. Integrações -> escolher marca;
2. conectar canal;
3. confirmar nome/username/Página corretos;
4. criar uma peça;
5. revisar;
6. aprovar;
7. conferir Quality Gate;
8. selecionar somente um canal;
9. agendar 2 a 5 minutos no futuro;
10. verificar item no **Minha semana**;
11. aguardar o worker;
12. confirmar `Publicado`;
13. abrir o link quando disponível;
14. atualizar desempenho;
15. conferir score e mensagem do MODO Learning;
16. repetir com os demais canais.

## Estados da fila

```text
scheduled  -> aguardando horário
publishing -> worker assumiu a publicação
retrying   -> falha recuperável; nova tentativa programada
published  -> provider confirmou publicação
failed     -> exige atenção/retry manual
cancelled  -> cancelado pelo usuário antes da publicação
```

## Regras de segurança

- criação do conteúdo não publica;
- aprovação do conteúdo não publica;
- o usuário precisa confirmar **Publicar agora** ou **Agendar**;
- a conexão é resolvida pela organização autenticada e marca do conteúdo;
- conteúdo de uma marca não é publicado no canal específico de outra marca;
- tokens não aparecem em respostas de API;
- tokens são criptografados em repouso;
- callbacks OAuth têm state/nonce e expiração;
- operações de publicação são persistidas com chave idempotente;
- falhas ficam registradas para auditoria.

## Meta App Review

Arquivo complementar:

```text
docs/META-APP-REVIEW-PUBLISHER.md
```

O código ficar pronto não substitui Advanced Access. A Meta precisa liberar as permissões para contas profissionais externas que não são administradores/testers do app.

## Postiz

Postiz permanece opcional. A MODO Publisher não depende dele para Instagram, Facebook, Threads, LinkedIn, agendamento ou analytics nativo.
