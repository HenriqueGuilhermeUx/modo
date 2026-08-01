# Meta App Review — Instagram Business Login

Este documento descreve o fluxo de revisão da integração oficial do Instagram na MODO.

## Escopo técnico

A MODO utiliza **Instagram API with Instagram Login (Instagram Business Login)**.

- Host de dados e publicação: `https://graph.instagram.com`
- Não utiliza `graph.facebook.com`
- Não utiliza token de Página do Facebook
- O `ig-user-id` é obtido dinamicamente após cada autorização em:

```text
GET https://graph.instagram.com/v21.0/me?fields=id,username,profile_picture_url
```

- O ID nunca é fixado no código nem fornecido manualmente.

## URLs cadastradas na Meta

### OAuth redirect URI

```text
https://modo-api-3m10.onrender.com/api/v1/instagram/callback
```

### Deauthorization callback URL

```text
https://modo-api-3m10.onrender.com/api/v1/instagram/deauthorize
```

### Data deletion request URL

```text
https://modo-api-3m10.onrender.com/api/v1/instagram/data-deletion
```

### Política de Privacidade

```text
https://modo1.netlify.app/politica-de-privacidade
```

### Instruções de exclusão de dados

```text
https://modo1.netlify.app/exclusao-de-dados
```

## Permissões solicitadas

```text
instagram_business_basic
instagram_business_content_publish
instagram_business_manage_insights
instagram_business_manage_comments
```

A publicação é iniciada somente após o usuário aprovar uma peça dentro da MODO e confirmar explicitamente a ação **Publicar no Instagram**.

## Usuário fixo de revisão

```text
E-mail: revisor@trynexa.com.br
Senha: valor configurado em REVIEWER_TEST_PASSWORD
```

A senha não fica armazenada no repositório, nesta documentação ou em logs. Ela deve ser informada ao revisor somente no campo seguro de instruções do App Review.

## Preparar ou atualizar o usuário de revisão

No Render, configure:

```env
REVIEWER_TEST_PASSWORD=<senha forte exclusiva para a revisão>
```

Depois execute no Shell do serviço da API:

```bash
npm run seed:meta-reviewer --workspace=@modo/api
```

O script é idempotente e prepara:

- usuário `revisor@trynexa.com.br`;
- organização `MODO · Revisão Meta`;
- marca `Marca de Teste · Meta Review`;
- assinatura de teste com acesso ao produto;
- senha derivada exclusivamente de `REVIEWER_TEST_PASSWORD`.

O revisor não precisa concluir o onboarding.

## Roteiro de teste da conexão

1. Acesse `https://modo1.netlify.app/app`.
2. Entre com `revisor@trynexa.com.br` e a senha fornecida no App Review.
3. Abra **Integrações** no painel ou acesse diretamente:

```text
https://modo1.netlify.app/app/settings/integrations
```

4. Na seção Instagram, mantenha selecionada a marca de teste.
5. Clique em **Conectar Instagram**.
6. Autorize usando uma conta Instagram profissional de teste com papel permitido no aplicativo.
7. Após o retorno à MODO, confirme que a tela exibe claramente:
   - foto de perfil, quando disponibilizada pela API;
   - `@username` da conta conectada;
   - ID da conta retornado dinamicamente;
   - data de expiração do token;
   - status da permissão de publicação.
8. Clique em **Desconectar Instagram** para validar a revogação local, se essa etapa fizer parte da revisão.

## Roteiro de teste da publicação

1. Dentro da conta de revisão, abra **Criar**.
2. Selecione a marca de teste.
3. Crie um post estático para o canal Instagram.
4. Aguarde a geração da imagem.
5. Revise e clique em **Aprovar conteúdo**.
6. Na área **Escolha o próximo passo**, localize o cartão Instagram.
7. Clique em **Publicar no Instagram**.
8. Confirme a publicação no diálogo apresentado pela MODO.
9. Ao final, clique em **Ver post publicado**.
10. Confirme visualmente que a imagem e a legenda aprovadas aparecem na conta Instagram de teste.

## Fluxo técnico de publicação

A MODO utiliza o `instagramUserId` salvo durante a autenticação e executa:

```text
POST https://graph.instagram.com/v21.0/{ig-user-id}/media
```

Parâmetros:

```text
image_url=<URL pública da imagem aprovada>
caption=<legenda aprovada>
```

Depois acompanha opcionalmente o processamento:

```text
GET https://graph.instagram.com/v21.0/{creation-id}?fields=status_code
```

E conclui:

```text
POST https://graph.instagram.com/v21.0/{ig-user-id}/media_publish
```

Parâmetro:

```text
creation_id=<creation-id retornado na primeira chamada>
```

## Segurança e dados

- A MODO nunca recebe ou armazena a senha do Instagram.
- Tokens de acesso são criptografados com AES-256-GCM antes da persistência.
- O estado OAuth é assinado, possui expiração e só pode ser consumido uma vez.
- `access_token`, `client_secret` e `REVIEWER_TEST_PASSWORD` não são registrados em logs.
- A URL da imagem é validada como HTTP/HTTPS pública antes da publicação.
- O callback de desautorização valida o `signed_request` da Meta antes de remover a conexão.
- A solicitação de exclusão valida o `signed_request`, elimina os dados sob controle da MODO e retorna `url` e `confirmation_code`.

## Variáveis de produção

```env
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
INSTAGRAM_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/instagram/callback
INSTAGRAM_TOKEN_ENCRYPTION_SECRET=
INSTAGRAM_SCOPES=instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_comments
INSTAGRAM_API_VERSION=v21.0
INSTAGRAM_GRAPH_BASE_URL=https://graph.instagram.com
REVIEWER_TEST_PASSWORD=
```

Nunca envie segredos ao GitHub ou os inclua em capturas de tela da revisão.
