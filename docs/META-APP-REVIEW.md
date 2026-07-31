# Meta App Review — Integração Instagram da MODO

Este documento descreve o fluxo de teste da integração oficial **Instagram API with Instagram Login** da MODO.

## URLs públicas

- Aplicação: `https://modo1.netlify.app/app`
- Central de integrações: `https://modo1.netlify.app/app/settings/integrations`
- Callback OAuth: `https://modo-api-3m10.onrender.com/api/v1/instagram/callback`
- Desautorização: `https://modo-api-3m10.onrender.com/api/v1/instagram/deauthorize`
- Solicitação de exclusão pela Meta: `https://modo-api-3m10.onrender.com/api/v1/instagram/data-deletion`
- Política de privacidade: `https://modo1.netlify.app/politica-de-privacidade`
- Instruções de exclusão: `https://modo1.netlify.app/exclusao-de-dados`

## Credenciais da conta fixa de revisão

- E-mail: `revisor@trynexa.com.br`
- Senha: informar no campo de credenciais do App Review da Meta. O valor é configurado exclusivamente pela variável segura `REVIEWER_TEST_PASSWORD` no ambiente de produção e não fica gravado neste repositório.

A conta é preparada automaticamente por um seed idempotente durante a inicialização da API. Ela já possui:

- organização `MODO App Review`;
- marca `MODO Review Brand`;
- assinatura ativa para executar o fluxo sem onboarding e sem bloqueio de créditos.

## Como testar a conexão

1. Acesse `https://modo1.netlify.app/app`.
2. Entre com o e-mail `revisor@trynexa.com.br` e a senha fornecida no formulário de revisão.
3. Abra **Integrações** no menu ou acesse diretamente `https://modo1.netlify.app/app/settings/integrations`.
4. No cartão **Instagram**, mantenha selecionada a marca `MODO Review Brand`.
5. Clique em **Conectar Instagram**.
6. Autorize o aplicativo com uma conta profissional de teste do Instagram disponibilizada para a revisão.
7. Após o retorno à MODO, confirme que o cartão exibe claramente `@username` da conta realmente autenticada e o estado **Conectado**.

A MODO usa o identificador retornado dinamicamente por `GET https://graph.instagram.com/v21.0/me?fields=id,username`. Não existe ID de usuário Instagram fixo no código.

## Como testar uma publicação

1. Entre na conta fixa de revisão.
2. Abra um conteúdo com imagem gerada ou crie uma peça de teste.
3. Aprove o conteúdo.
4. Na área **Escolha o próximo passo**, localize **Publicar no Instagram**.
5. Clique no botão e aguarde a confirmação.
6. Ao final, use **Abrir post no Instagram** para visualizar a publicação.

A publicação é executada somente após ação explícita do usuário, em duas etapas:

1. `POST https://graph.instagram.com/v21.0/{ig-user-id}/media`
2. `POST https://graph.instagram.com/v21.0/{ig-user-id}/media_publish`

O `{ig-user-id}` é sempre o identificador salvo durante a autenticação da conta que está conectada.

## Permissões solicitadas

- `instagram_business_basic`
- `instagram_business_content_publish`
- `instagram_business_manage_insights`
- `instagram_business_manage_comments`

## Segurança e privacidade

- A MODO não solicita nem armazena a senha do Instagram.
- O token é recebido diretamente do Instagram, convertido para longa duração e armazenado criptografado com AES-256-GCM.
- Tokens, senha de revisão e client secret não são enviados para logs.
- A imagem precisa estar aprovada, gerada e disponível em URL pública validada antes da publicação.
- Nenhuma publicação é automática.

## Desconexão e exclusão

- O revisor pode usar **Desconectar Instagram** na Central de Integrações.
- A Meta pode chamar o endpoint público de desautorização com `signed_request`.
- A Meta pode chamar o endpoint público de exclusão de dados com `signed_request`; a resposta contém `url` e `confirmation_code` no formato esperado.

## Preparação manual do seed

O seed também pode ser executado explicitamente no ambiente da API:

```bash
REVIEWER_TEST_PASSWORD='valor-seguro' \
DATABASE_URL='postgres://...' \
npm run seed:meta-reviewer --workspace=@modo/api
```

A execução é idempotente: atualiza a senha a partir da variável segura, preserva uma única conta e garante organização, marca e assinatura válidas.
