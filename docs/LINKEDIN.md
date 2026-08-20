# MODO LinkedIn — Publisher V2

## Modos disponíveis

### Manual

Sem credenciais LinkedIn:

- criação de conteúdo especializado;
- aprovação na MODO;
- cópia do texto final;
- geração/download de PDF;
- publicação manual.

### Conectado — perfil do membro

O Publisher V2 usa o fluxo atual de OAuth/OIDC do LinkedIn:

- produto **Sign in with LinkedIn using OpenID Connect**;
- produto **Share on LinkedIn**;
- scopes `openid profile w_member_social`;
- perfil recuperado por `GET https://api.linkedin.com/v2/userinfo`;
- token criptografado;
- conexão associada à organização + marca;
- publicação e agendamento pelo Publisher.

A documentação oficial atual do LinkedIn substituiu o antigo `r_liteprofile` pelo fluxo OIDC para novas integrações. `w_member_social` continua sendo a permissão self-service para publicar em nome do membro autenticado.

## LinkedIn Developer

1. Crie/abra o aplicativo da MODO.
2. Associe a Company Page exigida pelo LinkedIn.
3. Em **Products**, habilite **Sign in with LinkedIn using OpenID Connect**.
4. Habilite **Share on LinkedIn**.
5. Cadastre durante a migração:

```text
https://modo-api-3m10.onrender.com/api/v1/linkedin/callback
https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/linkedin/callback
```

Novos clientes devem usar o callback V2. O callback V1 permanece apenas para migração de conexões antigas.

## Render

```env
PUBLIC_WEB_URL=https://modo1.netlify.app
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v1/linkedin/callback
LINKEDIN_PUBLISHER_REDIRECT_URI=https://modo-api-3m10.onrender.com/api/v2/publisher/oauth/linkedin/callback
LINKEDIN_SCOPES=openid profile w_member_social
LINKEDIN_TOKEN_ENCRYPTION_SECRET=
LINKEDIN_API_VERSION=202606
```

Nunca coloque Client Secret ou segredo de criptografia no frontend/GitHub.

## Publisher V2

Fluxo:

```text
cliente -> Publisher -> seleciona marca -> Conectar LinkedIn nesta marca
        -> OAuth oficial -> OIDC userinfo -> token criptografado
        -> conteúdo aprovado -> Quality Gate -> publicar/agendar
        -> status/calendário -> performance/Learning quando disponível
```

Rotas novas:

```text
POST /api/v2/publisher/connect/linkedin
GET  /api/v2/publisher/oauth/linkedin/callback
GET  /api/v2/publisher/connections?brandId=<uuid>
POST /api/v2/publisher/publications
```

As rotas V1 continuam disponíveis para migração.

## Company Pages

Publicação como **organização** não deve ser confundida com publicação como membro. Ela exige os produtos/permissões de organização concedidos pelo LinkedIn (por exemplo, acesso aplicável de Community Management/Marketing APIs) e autorização administrativa da Page.

O OAuth V2 implementado nesta fase conecta perfis de membros. O motor mantém suporte ao modelo de `connectionId`, portanto a futura conexão oficial de Pages entra sem alterar scheduler, calendário, retry ou Learning.

## Segurança

- OAuth state é persistido, single-use e expira;
- tokens usam AES-256-GCM;
- tokens não voltam ao navegador depois da troca;
- conexão pertence à organização e marca autenticadas;
- publicação depende de conteúdo aprovado e confirmação;
- retry/idempotência evitam duplicações acidentais;
- automações proibidas (scraping, visitas simuladas, convites em massa ou DMs em massa) não fazem parte do Publisher.
