# MODO Publisher V2 — operação e ativação

## Objetivo

A MODO passa a operar a jornada completa:

`contexto -> criação -> Quality Gate -> aprovação humana -> publicar/agendar -> analytics -> learning -> próxima recomendação`

Postiz não é obrigatório. O produto usa conectores nativos no backend hospedado no Render.

## Capacidades implementadas

- isolamento por organização e marca;
- múltiplas conexões sociais por marca/provider;
- escolha determinística da conta social por publicação;
- Instagram, Facebook Pages, Threads e LinkedIn;
- importar as autorizações Instagram/LinkedIn já existentes sem pedir a senha novamente;
- publicação imediata;
- agendamento;
- rascunho;
- idempotência por intenção e conta selecionada;
- retry exponencial com limite de tentativas;
- cancelamento e reenvio manual;
- Quality Gate antes da distribuição;
- calendário editorial;
- snapshots de analytics;
- score de performance;
- sinais `performed_well` e `performed_poorly` para a Inteligência Criativa;
- dashboard `/app/publisher`.

## Fluxo de cliente

1. Cliente entra na própria organização MODO.
2. Cadastra uma ou mais marcas de acordo com o plano.
3. Abre `Publisher` ou `Integrações`.
4. Seleciona a marca.
5. Autoriza o canal no ambiente oficial da rede social.
6. A MODO persiste a conexão vinculada à organização + marca + provider.
7. O cliente cria uma peça.
8. A peça passa por revisão e aprovação humana.
9. O Quality Gate avalia aprovação, copy, CTA, hashtags, mídia, estrutura e tópicos proibidos.
10. Quando houver mais de uma conta do mesmo canal, o cliente escolhe explicitamente a conta de destino.
11. O cliente escolhe `Publicar agora`, `Agendar` ou `Rascunho`.
12. A publicação é registrada com chave de idempotência que inclui a conta selecionada.
13. Em caso de falha transitória, entra em retry com backoff; falhas finais ficam visíveis para reenvio manual.
14. A MODO coleta métricas periodicamente.
15. Performance vira sinal de aprendizado para próximas recomendações.

## Multi-marca e Instagram

A conexão Instagram V1 já validada em produção mantém uma autorização ativa por organização. O Publisher V2 cria uma camada durável por marca.

Para cada marca:

1. selecione a marca;
2. conecte a conta profissional desejada no Instagram Business Login já existente;
3. abra `/app/publisher?brand=<brandId>`;
4. clique `Vincular Instagram conectado`;
5. o V2 copia o token já criptografado para a conexão daquela marca;
6. repita para outra marca/Instagram.

Assim a tabela V2 preserva simultaneamente os vínculos `Marca A -> Instagram A`, `Marca B -> Instagram B`, etc., mesmo que a conexão de compatibilidade V1 seja trocada depois.

Quando uma marca possui mais de uma conexão do mesmo provider, o `connectionId` escolhido pelo cliente é validado no backend contra organização, marca, provider e validade do token. O backend não substitui silenciosamente essa escolha pela conexão mais recente.

## Variáveis de produção

### Instagram — já em uso

```env
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
INSTAGRAM_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/instagram/callback
INSTAGRAM_TOKEN_ENCRYPTION_SECRET=
INSTAGRAM_SCOPES=instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments
INSTAGRAM_API_VERSION=v25.0
INSTAGRAM_GRAPH_BASE_URL=https://graph.instagram.com
```

### Facebook Pages

```env
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/facebook/callback
FACEBOOK_API_VERSION=v25.0
```

Permissões pedidas pelo fluxo:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `read_insights`

### Threads

```env
THREADS_APP_ID=
THREADS_APP_SECRET=
THREADS_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/threads/callback
THREADS_SCOPES=threads_basic,threads_content_publish,threads_manage_insights
```

### LinkedIn

```env
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/linkedin/callback
LINKEDIN_TOKEN_ENCRYPTION_SECRET=
LINKEDIN_API_VERSION=202607
```

O LinkedIn V1 continua responsável pelo OAuth. Depois da autorização, o Publisher V2 usa `Vincular LinkedIn conectado` para persistir o vínculo por marca.

## App Review / acesso externo

A conexão de uma conta controlada pelo desenvolvedor prova o OAuth, mas não substitui revisão de permissões para clientes externos.

Antes da abertura comercial:

### Instagram

Solicitar o nível de acesso exigido pela Meta para contas profissionais de terceiros para:

- `instagram_business_basic`;
- `instagram_business_content_publish`;
- `instagram_business_manage_insights`;
- `instagram_business_manage_comments` somente se a função de comentários for usada comercialmente.

Gravar um vídeo de revisão mostrando:

1. login na MODO;
2. seleção da marca;
3. botão Conectar Instagram;
4. autorização no Instagram;
5. retorno com username visível;
6. criação de uma peça;
7. aprovação humana;
8. Quality Gate;
9. escolha explícita da conta, quando houver mais de uma;
10. publicação controlada;
11. tela Publisher/performance.

Manter a conta de revisão da MODO funcional, com uma marca de teste e conteúdo suficiente para o avaliador.

### Facebook Pages

No app Meta, habilitar o produto adequado para Facebook Login/Pages, cadastrar a callback exata do Render e solicitar as permissões necessárias para páginas de clientes externos.

### Threads

Adicionar/configurar o produto Threads no app Meta, cadastrar a redirect URI exata e solicitar acesso às permissões usadas pelo produto antes de liberar contas de terceiros.

### LinkedIn

Configurar o aplicativo LinkedIn e solicitar os produtos/permissões que o painel do LinkedIn exigir para publicação de membros e/ou organizações. O endpoint `/api/v1/native-publisher/health` deve retornar `linkedin.configured=true` quando Client ID, Client Secret, redirect e encryption secret estiverem preenchidos.

## Quality Gate

O gate não publica automaticamente. Ele classifica a peça e pode bloquear riscos objetivos.

- aprovação humana;
- tamanho/clareza da legenda;
- CTA;
- hashtags;
- mídia obrigatória/recomendada;
- tópicos proibidos da marca;
- estrutura criativa.

Mesmo uma peça `recommended` exige ação explícita do cliente para publicar/agendar.

## Agendamento e resiliência

Publicações `scheduled` são processadas pelo worker interno do backend.

Falha transitória:

`publishing -> retrying -> retrying ... -> published`

Falha após o limite:

`publishing -> failed`

O cliente pode clicar `Tentar novamente`. A chave de idempotência impede criação acidental de duplicatas para a mesma intenção de publicação e preserva a conta social escolhida.

## Analytics e Learning

Cada publicação pode gerar snapshots de métricas. O worker também revisita publicações recentes periodicamente.

A MODO converte as métricas em score 0–100 e classifica:

- `>= 70`: `performed_well`;
- `<= 35`: `performed_poorly`;
- demais: `neutral`.

Sinais positivos/negativos são gravados uma única vez por snapshot no `CreativeIntelligenceService`. O dashboard resume qualidade, performance, falhas e recomendação de próximo movimento.

## Endpoints principais

```text
GET  /api/v2/publisher/health
GET  /api/v2/publisher/connections
POST /api/v2/publisher/connections/instagram/import
POST /api/v2/publisher/connections/linkedin/import
POST /api/v2/publisher/connect/facebook
POST /api/v2/publisher/connect/threads
GET  /api/v2/publisher/quality/:contentRequestId
POST /api/v2/publisher/publications
GET  /api/v2/publisher/publications
POST /api/v2/publisher/publications/:id/retry
POST /api/v2/publisher/publications/:id/cancel
POST /api/v2/publisher/publications/:id/analytics/refresh
GET  /api/v2/publisher/publications/:id/analytics
GET  /api/v2/publisher/brands/:brandId/insights
GET  /api/v2/publisher/brands/:brandId/calendar
```

## Segurança

- senha social nunca passa pela MODO;
- OAuth state é descartável e expira;
- tokens persistidos são criptografados;
- todas as operações privadas autenticam a organização;
- `brandId` é validado contra a organização autenticada;
- `connectionId`, quando informado, precisa pertencer à mesma organização, marca e provider e estar ativo;
- conteúdo precisa pertencer à mesma marca;
- publicação exige aprovação humana;
- Quality Gate precede distribuição;
- nenhuma chave privada é versionada no GitHub.

## Checklist depois do deploy

1. `GET /health` -> 200.
2. `GET /api/v2/publisher/health` -> `modo_native_v2` e `storage=postgres`.
3. Abrir `/app/publisher`.
4. Vincular o Instagram já conectado à marca de teste.
5. Confirmar que a conta selecionada no Publisher aparece como destino da publicação.
6. Gerar/aprovar uma peça.
7. Criar primeiro `Rascunho`.
8. Criar primeiro `Agendamento` curto e validar execução.
9. Fazer primeira publicação real controlada.
10. Atualizar desempenho após a rede disponibilizar métricas.
11. Confirmar recomendação do dashboard.
12. Configurar LinkedIn e validar conexão.
13. Configurar Meta App para Facebook/Threads e validar OAuth com contas de teste.
14. Concluir App Review/Advanced Access antes de abrir os conectores a clientes externos.
