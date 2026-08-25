# Meta App Review — MODO Publisher V2

Este documento é o roteiro operacional para revisão da integração oficial da MODO com Instagram e Facebook. Ele deve refletir o comportamento real do `main` e nunca incluir segredos.

## 1. Produto revisado

A MODO é uma plataforma de marketing em que o usuário:

1. cadastra uma marca;
2. cria conteúdo com contexto da própria marca;
3. revisa e aprova a peça;
4. conecta uma conta social que administra;
5. escolhe explicitamente publicar agora ou agendar;
6. acompanha o status e, quando disponível, métricas da publicação.

A MODO não publica automaticamente uma peça não aprovada.

## 2. Fluxo principal do Instagram

O Publisher V2 usa **Instagram API with Instagram Login** diretamente em `graph.instagram.com`.

- OAuth: Instagram Login;
- conexão vinculada a uma marca MODO;
- token criptografado antes de persistir;
- publicação somente em conexão selecionada daquela marca;
- API de produção: `v25.0`;
- callback principal do Publisher V2:

```text
https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/instagram/callback
```

O callback legado abaixo continua disponível para compatibilidade da tela antiga de integrações, mas não é o caminho que deve ser demonstrado no App Review do Publisher V2:

```text
https://modo-api-3m10.onrender.com/api/v1/instagram/callback
```

## 3. Permissões solicitadas no Instagram

O ambiente de produção solicita apenas permissões usadas pelo produto:

```text
instagram_business_basic
instagram_business_content_publish
instagram_business_manage_insights
```

### instagram_business_basic

Usada para identificar a conta profissional autorizada e exibir dados básicos da conexão, como ID e `@username`.

### instagram_business_content_publish

Usada para publicar a imagem e legenda que o próprio usuário revisou/aprovou dentro da MODO.

### instagram_business_manage_insights

Usada pelo Publisher para consultar métricas das publicações e alimentar a visão de performance/aprendizado da marca.

`instagram_business_manage_comments` não faz parte do escopo de produção enquanto a MODO não tiver uma função ativa que dependa dessa permissão.

## 4. Facebook Pages

O Publisher V2 usa Facebook Login para listar Páginas administráveis e publicar na Página selecionada. O callback é:

```text
https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/facebook/callback
```

Permissões pedidas pelo fluxo atual:

```text
pages_show_list
pages_read_engagement
pages_manage_posts
read_insights
```

A conexão é salva por organização + marca + Página, permitindo que uma agência ou empresa mantenha destinos separados por marca.

## 5. URLs de privacidade, desautorização e exclusão

### Política de Privacidade

```text
https://modo1.netlify.app/politica-de-privacidade
```

### Instruções públicas de exclusão

```text
https://modo1.netlify.app/exclusao-de-dados
```

### Deauthorization callback

```text
https://modo-api-3m10.onrender.com/api/v1/instagram/deauthorize
```

### Data deletion callback

```text
https://modo-api-3m10.onrender.com/api/v1/instagram/data-deletion
```

Os dois callbacks validam o `signed_request` com HMAC-SHA256. A limpeza cobre tanto a integração Instagram legada quanto as conexões Instagram do Publisher V2 em `modo_native_social_connections`. A exclusão de uma conexão V2 remove em cascata os registros operacionais dependentes que pertencem àquela conexão.

A resposta de data deletion retorna `url` e `confirmation_code` conforme o fluxo já implementado.

## 6. Conta fixa de revisão

```text
E-mail: revisor@trynexa.com.br
Senha: valor configurado em REVIEWER_TEST_PASSWORD
```

Nunca registrar a senha em GitHub, issue, log, vídeo ou captura de tela. Inserir a senha somente no campo seguro de instruções para o revisor.

### Preparar/atualizar a conta

No ambiente Render:

```env
REVIEWER_TEST_PASSWORD=<senha forte exclusiva para revisão>
```

Depois, no Shell do serviço:

```bash
npm run seed:meta-reviewer --workspace=@modo/api
```

O seed é idempotente e prepara:

- usuário `revisor@trynexa.com.br`;
- organização `MODO · Revisão Meta`;
- marca `Marca de Teste · Meta Review`;
- assinatura de teste;
- acesso sem exigir conclusão do onboarding normal.

## 7. Roteiro para o vídeo do Instagram

Gravar um vídeo curto, contínuo e sem cortes que escondam etapas relevantes.

1. Abrir `https://modo1.netlify.app/app`.
2. Fazer login com a conta de revisão.
3. Abrir **Publisher** (`/app/publisher`).
4. Selecionar `Marca de Teste · Meta Review`.
5. No cartão Instagram, clicar **Conectar Instagram**.
6. Mostrar o redirecionamento para a tela oficial do Instagram e concluir a autorização com uma conta profissional de teste permitida no app.
7. Após o callback, mostrar a conexão vinculada à marca, incluindo o `@username` retornado pela API.
8. Abrir **Criar**, gerar uma peça de teste para Instagram e mostrar a etapa de revisão/aprovação.
9. Voltar ao fluxo de publicação e selecionar a conta Instagram conectada.
10. Escolher **Publicar agora** (ou agendar, se o item submetido à revisão for o agendamento).
11. Mostrar o status final no Publisher e abrir o permalink quando disponível.
12. Se a revisão incluir insights, usar **Atualizar desempenho** em uma publicação compatível e mostrar a métrica retornada.

O vídeo deve deixar evidente que a MODO não escolhe uma conta arbitrariamente: a conexão pertence à marca e o destino é explicitamente selecionado no Publisher.

## 8. Texto sugerido para “Como esta permissão é usada?”

### instagram_business_basic

> A MODO permite que uma empresa conecte sua própria conta profissional do Instagram a uma marca dentro da plataforma. Após a autorização, usamos esta permissão para identificar a conta conectada e exibir ao usuário o ID e o nome de usuário da conta que ele autorizou. A MODO não solicita nem armazena a senha do Instagram.

### instagram_business_content_publish

> A MODO é uma plataforma de criação e publicação de marketing. O usuário cria ou revisa uma peça, aprova o conteúdo e então escolhe explicitamente a conta Instagram conectada para publicar ou agendar. Esta permissão é usada somente para enviar ao Instagram o conteúdo aprovado pelo próprio usuário.

### instagram_business_manage_insights

> Depois que uma publicação é feita pela conta autorizada, o usuário pode solicitar a atualização de desempenho no Publisher. A MODO usa os insights disponíveis para exibir métricas e gerar recomendações de melhoria para a própria marca do usuário.

## 9. Evidências/capturas que devem acompanhar a submissão

Preparar, sem mostrar tokens ou segredos:

- tela de login da conta de revisão;
- Publisher com marca selecionada;
- botão **Conectar Instagram**;
- consentimento/autorização oficial;
- Publisher após conexão mostrando `@username`;
- conteúdo em estado aprovado;
- seleção explícita da conta de destino;
- confirmação de publicar/agendar;
- status `Publicado` e permalink, quando disponível;
- tela de Política de Privacidade;
- tela pública de Exclusão de Dados.

## 10. Fluxo técnico resumido de publicação Instagram

Após a autorização, o token é trocado por token de longa duração e a identidade é obtida em `graph.instagram.com/v25.0/me`.

Publicação de imagem:

```text
POST https://graph.instagram.com/v25.0/{ig-user-id}/media
POST https://graph.instagram.com/v25.0/{ig-user-id}/media_publish
GET  https://graph.instagram.com/v25.0/{media-id}?fields=permalink
```

A URL da imagem deve ser pública e validada pela MODO antes do envio.

## 11. Segurança

- OAuth `state` aleatório, persistido, com expiração e consumo único;
- tokens criptografados em AES-256-GCM;
- tokens, `client_secret` e senha de revisão não devem aparecer em logs;
- conexão validada por organização + marca + provider + conta;
- Quality Gate impede publicação de peça bloqueada;
- idempotência reduz duplicidade de publicação;
- callbacks de desautorização/exclusão validam assinatura Meta antes de apagar dados.

## 12. Variáveis relevantes de produção

```env
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
INSTAGRAM_PUBLISHER_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/instagram/callback
INSTAGRAM_TOKEN_ENCRYPTION_SECRET=
INSTAGRAM_SCOPES=instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights
INSTAGRAM_API_VERSION=v25.0
INSTAGRAM_GRAPH_BASE_URL=https://graph.instagram.com
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/facebook/callback
FACEBOOK_API_VERSION=v25.0
REVIEWER_TEST_PASSWORD=
```

## 13. Checklist imediatamente antes de enviar para revisão

- `/health` aponta para o commit que contém este hardening;
- `GET /api/v2/publisher/health` mostra Instagram configurado;
- login do revisor funciona;
- a marca de teste existe;
- a conta Instagram de teste está elegível para o app;
- callback V2 está cadastrado exatamente como em produção;
- Política de Privacidade e Exclusão de Dados abrem sem autenticação;
- nenhum segredo aparece no vídeo;
- o vídeo demonstra o uso real de cada permissão pedida.
