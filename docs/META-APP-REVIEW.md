# Meta App Review — MODO Publisher V2

Este documento descreve o fluxo de revisão do Publisher nativo da MODO para Instagram Business Login, Facebook Pages e Threads.

## Produto e arquitetura

- Produto: **MODO — Presença e Conteúdo**
- Web: `https://modo1.netlify.app`
- API: `https://modo-api-3m10.onrender.com`
- Central de distribuição: `https://modo1.netlify.app/app/publisher`
- Política de privacidade: `https://modo1.netlify.app/politica-de-privacidade`
- Exclusão de dados: `https://modo1.netlify.app/exclusao-de-dados`

Cada organização pode possuir várias marcas. Cada marca conecta suas próprias contas sociais por OAuth. Tokens são criptografados antes da persistência e ficam isolados por organização + marca + provider + conta social.

Nada é publicado apenas porque uma peça foi aprovada. O usuário precisa escolher **Publicar agora** ou **Agendar**. Agendamentos confirmados são executados pelo worker persistente no horário escolhido.

## Instagram — Instagram API with Instagram Login

A MODO utiliza Instagram Business Login e `graph.instagram.com`.

### Redirect URIs

Fluxo legado, preservado durante a migração:

```text
https://modo-api-3m10.onrender.com/api/v1/instagram/callback
```

Publisher V2 multi-marca:

```text
https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/instagram/callback
```

Cadastre **as duas URLs** enquanto houver usuários na conexão antiga. Novos clientes devem usar o fluxo V2.

### Deauthorization callback URL

```text
https://modo-api-3m10.onrender.com/api/v2/publisher/instagram/deauthorize
```

### Data deletion request URL

```text
https://modo-api-3m10.onrender.com/api/v2/publisher/instagram/data-deletion
```

Os callbacks V2 removem tanto conexões antigas quanto conexões multi-marca cujo `provider_account_id` corresponde ao usuário informado e deixam o cascade do banco remover publicações/analytics dependentes.

### Permissões solicitadas

```text
instagram_business_basic
instagram_business_content_publish
instagram_business_manage_insights
```

Não solicitar `instagram_business_manage_comments` enquanto a MODO não oferecer uma função real de gestão de comentários.

### Uso de cada permissão

- `instagram_business_basic`: identificar a conta profissional que o próprio cliente autorizou;
- `instagram_business_content_publish`: publicar a peça aprovada após confirmação explícita;
- `instagram_business_manage_insights`: mostrar desempenho ao cliente e alimentar o MODO Learning.

### Fluxo de publicação

1. cliente seleciona a marca em `/app/publisher`;
2. clica **Conectar Instagram nesta marca**;
3. autoriza no Instagram;
4. a conta volta associada à organização e marca que iniciaram o OAuth;
5. cliente cria/revisa/aprova a peça;
6. o MODO Quality Gate valida a peça;
7. cliente escolhe Instagram e a conta social;
8. cliente confirma **Publicar agora** ou **Agendar**;
9. a MODO publica usando somente o token daquela conexão;
10. performance retorna para a central e para o Learning.

## Facebook Pages

### Redirect URI

```text
https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/facebook/callback
```

### Permissões previstas

```text
pages_show_list
pages_read_engagement
pages_manage_posts
read_insights
```

A MODO lista somente as Páginas administráveis retornadas pela autorização e guarda os Page Access Tokens criptografados. Se a conta administrar várias Páginas, elas podem existir como conexões distintas e a conta correta é selecionada na publicação.

## Threads

### Redirect URI

```text
https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/threads/callback
```

### Permissões previstas

```text
threads_basic
threads_content_publish
threads_manage_insights
```

O fluxo segue a mesma governança: marca -> OAuth -> aprovação -> Quality Gate -> confirmação de publicação/agendamento -> analytics.

## Usuário de revisão

```text
E-mail: revisor@trynexa.com.br
Senha: valor configurado em REVIEWER_TEST_PASSWORD
```

A senha não fica no repositório ou nesta documentação. Informe-a somente no campo seguro de instruções do App Review.

Para preparar/atualizar o usuário de revisão no Render:

```bash
npm run seed:meta-reviewer --workspace=@modo/api
```

## Roteiro do screencast — Instagram

Gravar uma captura contínua:

1. entrar na MODO com a conta de revisão;
2. abrir `https://modo1.netlify.app/app/publisher`;
3. escolher a marca de teste;
4. clicar **Conectar Instagram nesta marca**;
5. mostrar o consentimento oficial;
6. concluir OAuth;
7. mostrar `@username` conectado no Publisher;
8. abrir/criar conteúdo da mesma marca;
9. revisar e aprovar;
10. mostrar o **MODO Quality Gate**;
11. escolher Instagram e a conta conectada;
12. confirmar publicação imediata ou agendamento;
13. mostrar o status **Publicado**;
14. abrir o post real;
15. voltar ao Publisher e atualizar desempenho;
16. mostrar métricas e recomendação/Learning.

## Roteiro do screencast — Facebook

1. Publisher -> marca;
2. **Conectar Facebook Pages**;
3. OAuth Meta;
4. mostrar Página(s) associada(s) à marca;
5. conteúdo aprovado -> Quality Gate;
6. selecionar Facebook e a Página correta;
7. confirmar publicação/agendamento;
8. mostrar resultado e analytics.

## Roteiro do screencast — Threads

1. Publisher -> marca;
2. **Conectar Threads**;
3. OAuth;
4. mostrar conta associada;
5. conteúdo aprovado -> Quality Gate;
6. selecionar Threads;
7. confirmar publicação/agendamento;
8. mostrar resultado e analytics.

## Segurança e isolamento

- nenhuma senha social é solicitada pela MODO;
- tokens são criptografados com AES-256-GCM;
- OAuth state é persistido, expira e é consumido uma única vez;
- conexões são vinculadas a organização + marca + provider + conta;
- publicações usam `connectionId` explícito quando há mais de uma conta;
- idempotência impede duplicação por repetição da mesma ação;
- falhas recebem retry controlado e podem ser reenviadas manualmente;
- exclusão/desautorização remove os dados de conexão do V1 e V2;
- segredos de produção permanecem no Render e nunca no GitHub.

## Variáveis de produção

```env
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
INSTAGRAM_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/instagram/callback
INSTAGRAM_PUBLISHER_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/instagram/callback
INSTAGRAM_TOKEN_ENCRYPTION_SECRET=
INSTAGRAM_SCOPES=instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights
INSTAGRAM_API_VERSION=v21.0
INSTAGRAM_GRAPH_BASE_URL=https://graph.instagram.com

FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/facebook/callback
FACEBOOK_API_VERSION=v26.0

THREADS_APP_ID=
THREADS_APP_SECRET=
THREADS_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/threads/callback
THREADS_SCOPES=threads_basic,threads_content_publish,threads_manage_insights

REVIEWER_TEST_PASSWORD=
```

## Checklist antes de solicitar Advanced Access

- [ ] `/health` responde 200;
- [ ] `/api/v2/publisher/health` responde 200;
- [ ] `/api/v2/publisher/direct-oauth/health` mostra Instagram configurado;
- [ ] nova redirect URI do Instagram cadastrada na Meta;
- [ ] deauthorization callback alterado para V2;
- [ ] data deletion callback alterado para V2;
- [ ] conta de revisão funciona;
- [ ] OAuth real da marca de teste funciona;
- [ ] Quality Gate aparece antes da distribuição;
- [ ] publicar agora funciona;
- [ ] agendamento funciona;
- [ ] analytics volta para o Publisher;
- [ ] política de privacidade abre sem login;
- [ ] página de exclusão abre sem login;
- [ ] screencast mostra o uso de cada permissão solicitada.
